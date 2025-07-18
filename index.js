// 📦 Imports
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const dotenv = require('dotenv');
const http = require('http');
const { registerStatus } = require('./status.js');

dotenv.config();

// ✅ Config
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_IDS = process.env.GUILD_IDS.split(',').map((g) => g.trim());
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// ⚡ Slash Command Definition
const commands = [
  new SlashCommandBuilder()
    .setName('anwesenheit')
    .setDescription('Erstellt eine Anwesenheitsabfrage')
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Format: YYYY-MM-DD HH:MM')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Beschreibung des Events (inkl. Uhrzeit, falls nötig)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('titel')
        .setDescription('Optional: Titel der Anwesenheitsabfrage')
        .setRequired(false)
    )
    .addNumberOption((option) =>
      option
        .setName('frist_in_minuten')
        .setDescription('Optional: Minuten bis Anmeldeschluss (Standard: 24h vorher)')
        .setRequired(false)
    )
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// 🚀 Slash Commands registrieren
(async () => {
  for (const guildId of GUILD_IDS) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), {
        body: commands.map((command) => command.toJSON())
      });
      console.log(`✅ Slash Command für Guild ${guildId} registriert!`);
    } catch (error) {
      if (error.code === 50001) {
        console.warn(
          `⚠️  Keine Berechtigung für Guild ${guildId}. Bot ist vermutlich nicht darauf eingeladen!`
        );
      } else {
        console.error(
          `❌ Konnte Slash Command für Guild ${guildId} nicht registrieren: ${error.message}`
        );
      }
    }
  }
})();

// 👇 Eventdaten
const events = new Map();

// 👇 Client Logic
client.on('interactionCreate', async (interaction) => {
// Slash Command "anwesenheit"
  if (interaction.isChatInputCommand() && interaction.commandName === 'anwesenheit') {
    // Defer the reply immediately. This tells Discord "I'm working on it"
    await interaction.deferReply({ ephemeral: true }); // You can choose to make the defer ephemeral or not

    const dateInput = interaction.options.getString('datum');
    const description = interaction.options.getString('beschreibung');
    const customTitle = interaction.options.getString('titel') || '📢 Anwesenheitsabfrage';
    const eventDate = new Date(dateInput);

    const deadlineMinutes = interaction.options.getNumber('frist_in_minuten');
    let deadline;

    if (deadlineMinutes !== null && !isNaN(deadlineMinutes)) {
      deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000);
    } else {
      deadline = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
    }

    if (deadline >= eventDate) {
      // If validation fails, edit the deferred reply to show the error
      return interaction.editReply({
        content: '❌ Die Anmeldefrist muss **vor** dem Event liegen.',
        ephemeral: true // Ensure this remains ephemeral if the defer was
      });
    }

    const eventId = interaction.id;

    events.set(eventId, {
      date: eventDate,
      deadline,
      description,
      title: customTitle,
      signedUp: new Set(),
      signedOff: new Set(),
      message: null
    });

    const embed = buildEventEmbed(eventId);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`signup_${eventId}`)
        .setLabel('Anmelden')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`signoff_${eventId}`)
        .setLabel('Abmelden')
        .setStyle(ButtonStyle.Danger)
    );

    // After successful processing, edit the deferred reply to show the actual content
    const reply = await interaction.editReply({
      embeds: [embed],
      components: [row],
      ephemeral: false // The final message should likely be visible to everyone
    });

    events.get(eventId).message = reply;
    return;
  }

  // Button Interaktionen
  if (interaction.isButton()) {
    const [action, eventId] = interaction.customId.split('_');
    const eventData = events.get(eventId);

    if (!eventData) {
      return interaction.reply({ content: 'Event nicht gefunden.', ephemeral: true });
    }

    const username = interaction.user.username;

    // Defer button interaction reply as well if processing might take time, or if you plan to edit later.
    // For simple responses like this, an immediate ephemeral reply is often fine.
    // await interaction.deferUpdate(); // Use deferUpdate for button interactions if you won't send a new message

    // Only Logging if deadline exceeded
    if (new Date() > eventData.deadline && LOG_CHANNEL_ID) {
      const logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(
          `${username} hat sich **nach Frist** ${
            action === 'signup' ? 'angemeldet' : 'abgemeldet'
          } (Event: "${eventData.title}").`
        );
      }
    }

    if (action === 'signup') {
      eventData.signedUp.add(username);
      eventData.signedOff.delete(username);
      // For button interactions, you can reply ephemerally directly
      await interaction.reply({
        content: `✅ Du hast dich für das Event angemeldet!`,
        ephemeral: true
      });
    } else if (action === 'signoff') {
      eventData.signedOff.add(username);
      eventData.signedUp.delete(username);
      await interaction.reply({
        content: `❌ Du hast dich vom Event abgemeldet!`,
        ephemeral: true
      });
    }

    const updatedEmbed = buildEventEmbed(eventId);
    if (eventData.message) {
      await eventData.message.edit({ embeds: [updatedEmbed] });
    }
  }
});

// 🛠 Hilfsfunktion zum Bauen des Embeds
function buildEventEmbed(eventId) {
  const eventData = events.get(eventId);
  if (!eventData) return new EmbedBuilder().setDescription('Event nicht gefunden');

  const signups = Array.from(eventData.signedUp);
  const signoffs = Array.from(eventData.signedOff);

  return new EmbedBuilder()
    .setTitle(eventData.title)
    .setDescription(eventData.description)
    .addFields(
      {
        name: `✅ Angemeldet (${signups.length})`,
        value: signups.length > 0 ? signups.join('\n') : 'Keine Anmeldungen',
        inline: true
      },
      {
        name: `❌ Abgemeldet (${signoffs.length})`,
        value: signoffs.length > 0 ? signoffs.join('\n') : 'Keine Abmeldungen',
        inline: true
      }
    )
    .setColor('#007BFF');
}

// Externe Status-Funktion (optional – eigene Implementierung)
registerStatus(client);

// ────────────────────────────────────────────────
// 🌡 Health‑Check‑Server
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🌡 Health‑Check‑Server läuft auf Port ${PORT}`);
});

// ✅ Client Login
client.login(TOKEN);