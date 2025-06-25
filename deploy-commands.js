//For test only (dubug)

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const dotenv = require("dotenv");

dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName("anwesenheit")
    .setDescription("Erstellt eine neue Anwesenheitsabfrage"),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// Hier unbedingt GUILD_ID und CLIENT_ID überprüfen
rest.put(
  Routes.applicationGuildCommands(
    process.env.CLIENT_ID,
    process.env.GUILD_ID
  ),
  { body: commands }
)
  .then(() => {
    console.log("✅ Slash-Befehle erfolgreich registriert!");
  })
  .catch(error => {
    console.error(error);
  });
