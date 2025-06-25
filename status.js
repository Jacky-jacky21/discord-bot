export function registerStatus(client) {
  client.once('ready', () => {
    console.log(`✅ Bot ist online! Eingeloggt als ${client.user.tag}`);
    client.user.setPresence({
      activities: [{ name: 'MIT DER BESTEN LIGA', type: 0 }], // 0 = PLAYING
      status: 'online',
    });
  });
}
