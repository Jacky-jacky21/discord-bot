// 📦 Imports
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const { registerStatus } = require('./status.js');
dotenv.config();

// ✅ Config
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_IDS = process.env.GUILD_IDS.split(',').map(g => g.trim());
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]
});

// ⚡️ Slash Command
const commands = [
  new SlashCommandBuilder()
    .setName('anwesenheit')
    .setDescription('Erstellt eine Anwesenheitsabfrage')
    .addStringOption(option =>
      option.setName('datum')
        .setDescription('Format: YYYY-MM-DD HH:MM')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('frist_in_minuten')
        .setDescription('Wie viele Minuten bis zum Anmeldeschluss?')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('beschreibung')
        .setDescription('Beschreibung des Events')
        .setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// 🚀 Slash Command registrieren
(async () => {
  for (const guildId of GUILD_IDS) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId),
        { body: commands.map(command => command.toJSON()) }
      );
      console.log(`✅ Slash Command für Guild ${guildId} registriert!`);
    } catch (error) {
      if (error.code === 50001) {
        console.warn(`⚠️ Keine Berechtigung für Guild ${guildId}. Bot ist vermutlich nicht darauf eingeladen!`);
      } else {
        console.error(`❌ Konnte Slash Command für Guild ${guildId} nicht registrieren: ${error.message}`);
      }
    }
  }
})();

// 👇 Eventdaten
const events = new Map();

// 👇 Client Logic
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'anwesenheit') {
    const dateInput = interaction.options.getString('datum');
    const deadlineMinutes = interaction.options.getNumber('frist_in_minuten');
    const description = interaction.options.getString('beschreibung');
    const eventDate = new Date(dateInput);
    const deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000);
    const eventId = interaction.id;

    events.set(eventId, {
      date: eventDate,
      deadline,
      description,
      signedUp: new Set(),
      signedOff: new Set(),
      message: null
    });

    const embed = buildEventEmbed(eventId);
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(`signup_${eventId}`).setLabel('Anmelden').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`signoff_${eventId}`).setLabel('Abmelden').setStyle(ButtonStyle.Danger),
      );

    const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    events.get(eventId).message = reply;

  } else if (interaction.isButton()) {
    const [action, eventId] = interaction.customId.split('_');
    const eventData = events.get(eventId);

    if (!eventData) {
      return interaction.reply({ content: 'Event nicht gefunden.', ephemeral: true });
    }

    const username = interaction.user.username;

    if (new Date() > eventData.deadline && LOG_CHANNEL_ID) {
      const logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(`${username} hat sich **nach Frist** ${action === 'signup' ? 'angemeldet' : 'abgemeldet'} für ${eventData.date.toLocaleString()}.`);
      }
    }

    if (action === 'signup') {
      eventData.signedUp.add(username);
      eventData.signedOff.delete(username);
      await interaction.reply({ content: `✅ Du hast dich für das Event am ${eventData.date.toLocaleString()} angemeldet!`, ephemeral: true });
    } else {
      eventData.signedOff.add(username);
      eventData.signedUp.delete(username);
      await interaction.reply({ content: `❌ Du hast dich vom Event am ${eventData.date.toLocaleString()} abgemeldet!`, ephemeral: true });
    }

    const updatedEmbed = buildEventEmbed(eventId);
    if (eventData.message) {
      await eventData.message.edit({ embeds: [updatedEmbed] });
    }
  }
});

// 🛠️ Hilfsfunktion zum Bauen des Embeds
function buildEventEmbed(eventId) {
  const eventData = events.get(eventId);
  if (!eventData) return;

  const signups = Array.from(eventData.signedUp);
  const signoffs = Array.from(eventData.signedOff);

  return new EmbedBuilder()
    .setTitle(`📢 Anwesenheitsabfrage für Event am ${eventData.date.toLocaleString()}`)
    .setDescription(eventData.description + `\nAnmeldung möglich bis: ${eventData.deadline.toLocaleString()}`)
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

registerStatus(client);

// ✅ Client Login
client.login(TOKEN);
