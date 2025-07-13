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
  EmbedBuilder,
  ChannelType,
  MessageFlags // <--- NEU: Für MessageFlags.Ephemeral
} = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const http = require('http');
const { registerStatus } = require('./status.js');

dotenv.config();

// ✅ Config
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_IDS = process.env.GUILD_IDS.split(',').map((g) => g.trim());
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const EVENTS_FILE = './data/events.json';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

const events = new Map();

// 📁 Daten laden und speichern
function loadEventsFromFile() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const data = fs.readFileSync(EVENTS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (const [id, event] of Object.entries(parsed)) {
        events.set(id, {
          ...event,
          date: new Date(event.date),
          deadline: new Date(event.deadline),
          signedUp: new Set(event.signedUp || []),
          signedOff: new Set(event.signedOff || [])
        });
      }
      console.log('📂 Eventdaten geladen');
    } else {
      if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
      }
      fs.writeFileSync(EVENTS_FILE, JSON.stringify({}, null, 2));
      console.log('📂 Eventdaten-Datei erstellt');
    }
  } catch (err) {
    console.error('❌ Fehler beim Laden der Eventdaten:', err);
  }
}

function saveEventsToFile() {
  const obj = {};
  for (const [id, event] of events.entries()) {
    obj[id] = {
      date: event.date,
      deadline: event.deadline,
      description: event.description,
      signedUp: Array.from(event.signedUp),
      signedOff: Array.from(event.signedOff),
      messageId: event.messageId || null, // Stelle sicher, dass dies existiert
      channelId: event.channelId || null // Stelle sicher, dass dies existiert
    };
  }
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(obj, null, 2));
}

loadEventsFromFile();

// ⚡ Slash Command Definition
const commands = [
  new SlashCommandBuilder()
    .setName('anwesenheit')
    .setDescription('Erstellt eine Anwesenheitsabfrage')
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Format: YYYY-MM-DD HH:MM (24h)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('beschreibung')
        .setDescription('Beschreibung des Events')
        .setRequired(true)
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

// 👇 Client Logic
client.on('interactionCreate', async (interaction) => {
  // Slash Command "anwesenheit"
  if (interaction.isChatInputCommand() && interaction.commandName === 'anwesenheit') {
    // deferReply mit Flags für Ephemeral
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // <--- GEÄNDERT

    const dateInput = interaction.options.getString('datum');
    const description = interaction.options.getString('beschreibung');

    console.log(`Debug: Empfangener Datumseingabe-String: "${dateInput}"`);

    const dateParts = dateInput.split(' ');
    if (dateParts.length !== 2) {
      console.error(`Debug: Ungültiges dateInput Format. Erwartet 2 Teile, bekam ${dateParts.length}: "${dateInput}"`);
      return interaction.editReply({ content: '❌ Ungültiges Datumsformat. Bitte "YYYY-MM-DD HH:MM" verwenden.' });
    }

    const [yearStr, monthStr, dayStr] = dateParts[0].split('-');
    const [hourStr, minuteStr] = dateParts[1].split(':');

    console.log(`Debug: yearStr=${yearStr}, monthStr=${monthStr}, dayStr=${dayStr}, hourStr=${hourStr}, minuteStr=${minuteStr}`);

    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);

    console.log(`Debug: Geparste Datumskomponenten: Jahr=${year}, Monat=${month}, Tag=${day}, Stunde=${hour}, Minute=${minute}`);

    if (
      isNaN(year) || isNaN(month) || isNaN(day) ||
      isNaN(hour) || isNaN(minute) ||
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      hour < 0 || hour > 23 ||
      minute < 0 || minute > 59
    ) {
      console.error(`Debug: Datumsvalidierung fehlgeschlagen. Geparste Werte: Jahr=${year}, Monat=${month}, Tag=${day}, Stunde=${hour}, Minute=${minute}`);
      return interaction.editReply({ content: '❌ Ungültiges Datumsformat oder ungültige Zeit. Stellen Sie sicher, dass alle Zahlen gültig sind.' });
    }

    const eventDate = new Date(year, month - 1, day, hour, minute);

    console.log(`Debug: eventDate erstellt: ${eventDate.toISOString()} (Ist gültig: ${!isNaN(eventDate.getTime())})`);

    if (isNaN(eventDate.getTime())) {
      return interaction.editReply({ content: '❌ Das erstellte Event-Datum ist ungültig. Bitte überprüfen Sie das Format und die Werte erneut.' });
    }

    const deadlineMinutes = interaction.options.getNumber('frist_in_minuten');
    let deadline;

    if (deadlineMinutes !== null && !isNaN(deadlineMinutes)) {
      deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000);
    } else {
      deadline = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
    }
    
    console.log(`Debug: Frist erstellt: ${deadline.toISOString()} (Ist gültig: ${!isNaN(deadline.getTime())})`);

    if (isNaN(deadline.getTime())) {
      return interaction.editReply({ content: '❌ Die erstellte Anmeldefrist ist ungültig. Dies könnte auf ein Problem mit dem Event-Datum oder der Frist-Berechnung hindeuten.' });
    }

    if (deadline >= eventDate) {
      return interaction.editReply({
        content: '❌ Die Anmeldefrist muss **vor** dem Event liegen.'
      });
    }

    const eventId = interaction.id;

    // Erstelle Embed mit temporären Daten, bevor das Event in der Map gespeichert wird
    const embed = buildEventEmbed(eventId, eventDate, deadline, description, new Set(), new Set());
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

    // editReply, um die vorherige deferReply zu bearbeiten
    const reply = await interaction.editReply({
      embeds: [embed],
      components: [row],
      fetchReply: true // <--- Weiterhin fetchReply nutzen, um das Message-Objekt zu bekommen
    });

    events.set(eventId, {
      date: eventDate,
      deadline,
      description,
      signedUp: new Set(),
      signedOff: new Set(),
      messageId: reply.id,
      channelId: reply.channel.id
    });

    saveEventsToFile();
  }

  // Button Interaktionen
  if (interaction.isButton()) {
    // Zuerst deferUpdate, um die Interaktion zu bestätigen
    await interaction.deferUpdate(); // <--- NEU: Dies verhindert "Unknown interaction" und "already acknowledged"

    const [action, eventId] = interaction.customId.split('_');
    const eventData = events.get(eventId);

    if (!eventData) {
      // Nutze followUp, da deferUpdate bereits erfolgt ist
      return interaction.followUp({ content: 'Event nicht gefunden. (Event wurde möglicherweise gelöscht oder der Bot wurde neu gestartet und die Daten sind verloren gegangen)', flags: MessageFlags.Ephemeral }); // <--- GEÄNDERT
    }

    const username = interaction.user.username;

    if (new Date() > eventData.deadline && LOG_CHANNEL_ID) {
      const logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(
          `${username} hat sich **nach Frist** ${
            action === 'signup' ? 'angemeldet' : 'abgemeldet'
          } für ${formatDateTime(eventData.date)}.`
        );
      }
    }

    if (action === 'signup') {
      eventData.signedUp.add(username);
      eventData.signedOff.delete(username);
      // Nutze followUp nach deferUpdate
      await interaction.followUp({
        content: `✅ Du hast dich für das Event am ${formatDateTime(eventData.date)} angemeldet!`,
        flags: MessageFlags.Ephemeral // <--- GEÄNDERT
      });
    } else if (action === 'signoff') {
      eventData.signedOff.add(username);
      eventData.signedUp.delete(username);
      // Nutze followUp nach deferUpdate
      await interaction.followUp({
        content: `❌ Du hast dich vom Event am ${formatDateTime(eventData.date)} abgemeldet!`,
        flags: MessageFlags.Ephemeral // <--- GEÄNDERT
      });
    }

    saveEventsToFile();

    // Embed updaten: Message neu vom Cache holen und dann bearbeiten
    if (eventData.channelId && eventData.messageId) {
      try {
        const channel = client.channels.cache.get(eventData.channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          const message = await channel.messages.fetch(eventData.messageId);
          // Hole die aktuellsten Daten für das Embed aus der Map
          const currentEventData = events.get(eventId); // Sicherstellen, dass die aktuellsten Daten verwendet werden
          const updatedEmbed = buildEventEmbed(
            eventId,
            currentEventData.date,
            currentEventData.deadline,
            currentEventData.description,
            currentEventData.signedUp,
            currentEventData.signedOff
          );
          await message.edit({ embeds: [updatedEmbed] });
        } else {
          console.error(`Kanal ${eventData.channelId} nicht gefunden, ist kein Textkanal oder Bot hat keine Berechtigungen.`);
        }
      } catch (error) {
        console.error(`Fehler beim Aktualisieren der Nachricht ${eventData.messageId}:`, error);
        // Optional: Benutzer benachrichtigen, dass Update fehlgeschlagen ist
        await interaction.followUp({ content: '❌ Fehler beim Aktualisieren der Anwesenheitsliste.', flags: MessageFlags.Ephemeral }); // <--- GEÄNDERT
      }
    } else {
      console.warn(`Warnung: messageId oder channelId für Event ${eventId} fehlt, kann Embed nicht aktualisieren.`);
      await interaction.followUp({ content: '⚠️  Kann Anwesenheitsliste nicht aktualisieren (Nachrichtendaten fehlen).', flags: MessageFlags.Ephemeral }); // <--- GEÄNDERT
    }
  }
});

// Fügt eine führende Null hinzu, wenn die Zahl einstellig ist
const addLeadingZero = (num) => num < 10 ? '0' + num : num;

// 🛠 Hilfsfunktion zum Bauen des Embeds & Datumsformatierung
function formatDateTime(date) {
  if (isNaN(date.getTime())) {
    return "Ungültiges Datum/Zeit";
  }

  const day = addLeadingZero(date.getDate());
  const month = addLeadingZero(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = addLeadingZero(date.getHours());
  const minutes = addLeadingZero(date.getMinutes());

  // Manuelles Format, um AM/PM zu vermeiden
  return `${day}.${month}.${year}, ${hours}:${minutes} Uhr`;
}

function buildEventEmbed(eventId, date, deadline, description, signedUp, signedOff) {
  // Hier keine Abfrage von events.get(eventId) mehr, da Daten direkt übergeben werden
  return new EmbedBuilder()
    .setTitle(`📢 Anwesenheitsabfrage für Event am ${formatDateTime(date)}`)
    .setDescription(
      `${description}\nAnmeldung möglich bis: ${formatDateTime(deadline)}`
    )
    .addFields(
      {
        name: `✅ Angemeldet (${signedUp.size})`,
        value: signedUp.size > 0 ? Array.from(signedUp).join('\n') : 'Keine Anmeldungen',
        inline: true
      },
      {
        name: `❌ Abgemeldet (${signedOff.size})`,
        value: signoffs.size > 0 ? Array.from(signedOff).join('\n') : 'Keine Abmeldungen',
        inline: true
      }
    )
    .setColor('#007BFF');
}

registerStatus(client);

// ────────────────────────────────────────────────
// 🌡 Health‑Check‑Server (Render Free Tier + UptimeRobot)
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 10000; // <--- PORT auf 10000 gesetzt, da Render das erwartet

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else if (req.url === '/events.json') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(EVENTS_FILE, 'utf8'));
    } catch (error) {
      console.error("Fehler beim Lesen von events.json:", error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error: Could not read events.json');
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🌡 Health‑Check‑Server läuft auf Port ${PORT}`);
});

client.login(TOKEN);