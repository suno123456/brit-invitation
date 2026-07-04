import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ghfgqwslakjqmxuboobn.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ULTRAMSG_MASTER_TOKEN = process.env.ULTRAMSG_MASTER_TOKEN; 

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.query;
  // הוספת קבלת השדה to מתוך גוף הבקשה לצורכי הודעת מבחן
  const { event_id, message_text, to } = req.body;

  if (!event_id) return res.status(400).json({ error: 'Missing event_id' });

  try {
    // ---- 1. חיבור ראשוני וייצור QR (connect) ----
    if (action === 'connect') {
      const response = await fetch('https://api.ultramsg.com/v1/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ULTRAMSG_MASTER_TOKEN })
      });
      const instanceData = await response.json();

      if (!instanceData.instance_id) throw new Error('Failed to create instance');

      await supabase
        .from('events')
        .update({
          whatsapp_instance_id: instanceData.instance_id,
          whatsapp_token: instanceData.token,
          whatsapp_status: 'pending'
        })
        .eq('id', event_id);

      const qrUrl = `https://api.ultramsg.com/${instanceData.instance_id}/instance/qr?token=${instanceData.token}`;
      return res.status(200).json({ qr_url: qrUrl });
    }

    // ---- 2. בדיקת סטטוס חיבור (status) ----
    if (action === 'status') {
      const { data: event } = await supabase.from('events').select('whatsapp_instance_id, whatsapp_token').eq('id', event_id).single();
      if (!event?.whatsapp_instance_id) return res.status(200).json({ status: 'failed' });

      const response = await fetch(`https://api.ultramsg.com/${event.whatsapp_instance_id}/instance/status?token=${event.whatsapp_token}`);
      const statusData = await response.json();
      
      let currentStatus = 'pending';
      if (statusData.status === 'authenticated') currentStatus = 'connected';
      if (statusData.status === 'disconnected') currentStatus = 'failed';

      await supabase.from('events').update({ whatsapp_status: currentStatus }).eq('id', event_id);
      return res.status(200).json({ status: currentStatus });
    }

    // ---- 3. ניתוק מכשיר ומחיקתו (logout) ----
    if (action === 'logout') {
      const { data: event } = await supabase.from('events').select('whatsapp_instance_id, whatsapp_token').eq('id', event_id).single();
      if (event?.whatsapp_instance_id) {
        await fetch(`https://api.ultramsg.com/${event.whatsapp_instance_id}/instance/logout?token=${event.whatsapp_token}`, { method: 'POST' });
        await fetch(`https://api.ultramsg.com/v1/instances/${event.whatsapp_instance_id}`, { 
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ULTRAMSG_MASTER_TOKEN })
        });
      }
      
      await supabase.from('events').update({
        whatsapp_instance_id: null,
        whatsapp_token: null,
        whatsapp_status: 'failed'
      }).eq('id', event_id);

      return res.status(200).json({ ok: true, detail: "המכשיר נותק ואופס בהצלחה מהמערכת" });
    }

    // ---- 4. חיבור מחדש וריענון QR (relink) ----
    if (action === 'relink') {
      const response = await fetch('https://api.ultramsg.com/v1/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ULTRAMSG_MASTER_TOKEN })
      });
      const instanceData = await response.json();

      if (!instanceData.instance_id) throw new Error('Failed to regenerate instance');

      await supabase
        .from('events')
        .update({
          whatsapp_instance_id: instanceData.instance_id,
          whatsapp_token: instanceData.token,
          whatsapp_status: 'pending'
        })
        .eq('id', event_id);

      const qrUrl = `https://api.ultramsg.com/${instanceData.instance_id}/instance/qr?token=${instanceData.token}`;
      return res.status(200).json({ qr_url: qrUrl, ok: true, detail: "נוצר קוד QR חדש לסריקה" });
    }

    // ---- 5. שליחת הודעה (send) - תומך כעת גם בהודעת מבחן וגם בשליחה מרוכזת ----
    if (action === 'send') {
      const { data: event } = await supabase.from('events').select('whatsapp_instance_id, whatsapp_token').eq('id', event_id).single();
      if (!event?.whatsapp_instance_id) {
        return res.status(400).json({ ok: false, sent: 0, failed: 0, detail: "לא מוגדר וואטסאפ לאירוע זה" });
      }

      // 🎯 מסלול א': הודעת מבחן לנמען בודד (אם השדה to קיים בגוף הבקשה)
      if (to) {
        const response = await fetch(`https://api.ultramsg.com/${event.whatsapp_instance_id}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: event.whatsapp_token,
            to: to,
            body: message_text
          })
        });

        if (response.ok) {
          return res.status(200).json({ ok: true, sent: 1, failed: 0, detail: `הודעת המבחן נשלחה בהצלחה אל ${to}` });
        } else {
          const errData = await response.json();
          return res.status(200).json({ ok: false, sent: 0, failed: 1, detail: `כשל בשליחת הודעת מבחן: ${JSON.stringify(errData)}` });
        }
      }

      // 📊 מסלול ב': שליחה מרוכזת מהאקסל (אם השדה to לא קיים)
      const { data: guests } = await supabase.from('guests').select('*').eq('event_id', event_id).eq('source', 'imported').eq('status', 'לא נשלח');

      if (!guests || guests.length === 0) {
        return res.status(200).json({ ok: true, sent: 0, failed: 0, detail: "אין אורחים חדשים לשליחה ברשימה" });
      }

      let sent = 0; let failed = 0;

      for (const guest of guests) {
        if (!guest.phone) { failed++; continue; }

        const guestLink = `https://brit-invitation.vercel.app/?event=${encodeURIComponent(event_id)}`;
        const personalizedMessage = message_text.replace(/\[שם\]/g, guest.guest_name) + `\n\nקישור לאישור: ${guestLink}`;

        const response = await fetch(`https://api.ultramsg.com/${event.whatsapp_instance_id}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: event.whatsapp_token,
            to: guest.phone,
            body: personalizedMessage
          })
        });

        if (response.ok) {
          sent++;
          await supabase.from('guests').update({ status: 'נשלח' }).eq('id', guest.id);
        } else {
          failed++;
          await supabase.from('guests').update({ status: 'נכשל' }).eq('id', guest.id);
        }
      }

      return res.status(200).json({ 
        ok: true, 
        sent: sent, 
        failed: failed, 
        detail: `השליחה הסתיימה. נשלחו: ${sent}, נכשלו: ${failed}.` 
      });
    }

  } catch (error) {
    return res.status(500).json({ ok: false, sent: 0, failed: 0, detail: error.message });
  }
}
