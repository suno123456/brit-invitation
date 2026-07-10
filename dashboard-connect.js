// ========================================
// PLAN4ME | dashboard-connect.js
// חיבור הדשבורד לתוסף - להוסיף ל-dashboard.html:
//   <script src="dashboard-connect.js"></script>
// ========================================

// ה-IDs של התוסף: הראשון = הגרסה מחנות כרום (מה שלקוחות מתקינים),
// השני = טעינה מקומית לפיתוח (עם ה-key). הקוד מזהה אוטומטית מי מהם מותקן.
const PLAN4ME_EXTENSION_IDS = [
  'plleaopnlnhklknopoeaimlapechaghk', // חנות כרום
  'ngbmciekoigkfciicaljpnkinmfoekhb'  // פיתוח מקומי (unpacked)
];
let PLAN4ME_EXTENSION_ID = null; // נקבע אוטומטית ע"י plan4meIsInstalled

// בודק ID בודד. מחזיר Promise<boolean>
function plan4mePingId(extId) {
  return new Promise(function (resolve) {
    try {
      chrome.runtime.sendMessage(extId, { type: 'P4M_PING' }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) { resolve(false); return; }
        resolve(true);
      });
    } catch (e) { resolve(false); }
  });
}

// בודק אם התוסף מותקן (מנסה את כל ה-IDs) וקובע את הפעיל. מחזיר Promise<boolean>
async function plan4meIsInstalled() {
  if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return false;
  for (let i = 0; i < PLAN4ME_EXTENSION_IDS.length; i++) {
    if (await plan4mePingId(PLAN4ME_EXTENSION_IDS[i])) {
      PLAN4ME_EXTENSION_ID = PLAN4ME_EXTENSION_IDS[i];
      return true;
    }
  }
  return false;
}

/**
 * שולח קמפיין דרך התוסף.
 * @param {Object} opts
 * @param {Array}  opts.recipients - [{phone: '0501234567', name: 'ישראל'}, ...]
 * @param {String} opts.message    - טקסט ההודעה. {שם} יוחלף בשם הנמען.
 * @param {String} [opts.image]    - תמונה כ-dataURL (data:image/jpeg;base64,...) - לא חובה
 * @param {Number} [opts.delayMin] - השהיה מינימלית בשניות (ברירת מחדל 8)
 * @param {Number} [opts.delayMax] - השהיה מקסימלית בשניות (ברירת מחדל 15)
 * @returns {Promise<{ok:true, count:number}>}
 */
async function plan4meSend(opts) {
  if (!PLAN4ME_EXTENSION_ID) {
    const installed = await plan4meIsInstalled();
    if (!installed) throw new Error('תוסף PLAN4ME לא מותקן בדפדפן הזה');
  }
  return new Promise(function (resolve, reject) {
    if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('הדפדפן לא תומך בחיבור לתוסף (נדרש Chrome)')); return;
    }
    const recipients = Array.isArray(opts.recipients) ? opts.recipients : [];
    const message = String(opts.message || '').trim();
    if (recipients.length === 0) { reject(new Error('רשימת הנמענים ריקה')); return; }
    if (!message) { reject(new Error('אין טקסט הודעה')); return; }

    const queue = recipients.map(function (r) {
      const name = String((r && r.name) || '');
      return {
        phone: String((r && r.phone) || ''),
        name: name,
        text: message.replace(/\{שם\}/g, name)
      };
    });

    chrome.runtime.sendMessage(PLAN4ME_EXTENSION_ID, {
      type: 'P4M_START',
      queue: queue,
      delayMin: opts.delayMin || 8,
      delayMax: opts.delayMax || 15,
      image: opts.image || null
    }, function (resp) {
      if (chrome.runtime.lastError) {
        reject(new Error('התוסף לא מותקן או לא זמין. התקינו את תוסף PLAN4ME ונסו שוב.'));
        return;
      }
      if (resp && resp.ok) { resolve(resp); }
      else { reject(new Error((resp && resp.error) || 'התוסף לא הגיב')); }
    });
  });
}

/* ===== דוגמת שימוש בדשבורד =====

document.getElementById('sendViaExtensionBtn').addEventListener('click', async () => {
  try {
    const installed = await plan4meIsInstalled();
    if (!installed) { alert('תוסף PLAN4ME לא מותקן בדפדפן הזה'); return; }

    const result = await plan4meSend({
      recipients: guestList,          // הרשימה שכבר יש לדשבורד: [{phone, name}, ...]
      message: messageText,           // כולל {שם} וקישור אישור ההגעה
      image: invitationDataUrl,       // אופציונלי
      delayMin: 8,
      delayMax: 15
    });
    alert('השליחה החלה! ' + result.count + ' נמענים. עברו לטאב וואטסאפ.');
  } catch (e) {
    alert('שגיאה: ' + e.message);
  }
});

===== סבב תזכורות =====
בדיוק אותו plan4meSend - רק עם רשימה מסוננת:
const notConfirmed = guestList.filter(g => !confirmedPhones.has(normalizePhone(g.phone)));
plan4meSend({ recipients: notConfirmed, message: reminderText });
*/
