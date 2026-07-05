export default async function handler(req, res) {
  // מאפשרים ללנדבוט לפנות לשרת מכל דומיין (פתרון CORS סופי)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. חילוץ ה-event_id שלנדבוט שולח לנו בגוף הבקשה
    const { event_id } = req.body || {};
    
    if (!event_id) {
      return res.status(400).json({ error: 'Missing event_id' });
    }

    const token = "55b1136bb38f67f6bb6781e386dde6883a4618d8";
    
    // 2. פנייה לספק הוואטסאפ שלך כדי למשוך קוד QR טרי
    // הערה: אם יש לך את ה-Base URL המדויק (כמו ultramsg או green-api), נחליף את הכתובת פה למטה
    const whatsappProviderUrl = `https://api.ultramsg.com/instance98213/instance/qr?token=${token}`; 
    
    const response = await fetch(whatsappProviderUrl);
    const data = await response.json();

    // 3. חילוץ ה-QR מהספק והחזרתו בפורמט המדויק שלנדבוט מחפש
    // אנחנו מניחים שהספק מחזיר את זה בתוך data.base64 או data.image, או כקישור ישיר
    const qrUrl = data.base64 || data.qr || data.url || ""; 

    // החזרת תשובה חיובית ללנדבוט (סטטוס 200 במקום 404!)
    return res.status(200).json({ 
      success: true,
      qr_url: qrUrl,
      event_id: event_id
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
