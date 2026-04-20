export default function handler(req, res) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  // Scopes: Gmail lectura + Sheets escritura
  const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/spreadsheets');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  res.redirect(302, url);
}
