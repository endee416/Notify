// index.js require('dotenv').config(); const admin = require('firebase-admin'); const { Expo } = require('expo-server-sdk'); const cron = require('node-cron');

// 1. Initialize Firebase Admin with your FCM V1 Service Account JSON const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); admin.initializeApp({ credential: admin.credential.cert(serviceAccount), }); const db = admin.firestore();

// 2. Instantiate Expo SDK configured for FCM V1 const expo = new Expo({ useFcmV1: true });

// 3. Utility: send push notification chunks async function sendPushNotifications(messages) { const chunks = expo.chunkPushNotifications(messages); for (const chunk of chunks) { try { const tickets = await expo.sendPushNotificationsAsync(chunk); console.log('Push tickets:', tickets); } catch (err) { console.error('Push error:', err); } } }

// 4. Real-time listener for order status transitions const lastStatusMap = new Map(); let isInitialLoad = true;

db.collection('orders').onSnapshot( async (snapshot) => { if (isInitialLoad) { // Seed initial statuses snapshot.docs.forEach((doc) => lastStatusMap.set(doc.id, doc.data().status)); isInitialLoad = false; console.log('Initial order status cache populated'); return; }

for (const change of snapshot.docChanges()) {
  if (change.type !== 'modified') continue;

  const orderId = change.doc.id;
  const beforeStatus = lastStatusMap.get(orderId);
  const data = change.doc.data();
  const afterStatus = data.status;
  lastStatusMap.set(orderId, afterStatus);

  if (beforeStatus === afterStatus) continue;
  console.log(`Order ${orderId} status changed: ${beforeStatus} -> ${afterStatus}`);

  const messages = [];
  const makeMessage = (token, body) => ({
    to: token,
    sound: 'default',
    title: 'School Chow 🍔',
    body,
    data: { orderId },
  });

  // cart -> pending: notify vendor
  if (beforeStatus === 'cart' && afterStatus === 'pending') {
    const vsnap = await db.collection('users').where('uid', '==', data.vendoruid).get();
    vsnap.forEach((doc) => {
      const u = doc.data();
      if (Expo.isExpoPushToken(u.pushToken)) {
        messages.push(
          makeMessage(u.pushToken, `Hi ${u.firstname || 'there'}! New pending order: ${data.foodItem}`)
        );
      }
    });
  }

  // pending -> packaged: notify drivers
  if (beforeStatus === 'pending' && afterStatus === 'packaged' && !data.driveruid) {
    const dsnap = await db.collection('users').where('role', '==', 'driver').get();
    dsnap.forEach((doc) => {
      const d = doc.data();
      if (Expo.isExpoPushToken(d.pushToken)) {
        messages.push(
          makeMessage(d.pushToken, `Hey ${d.firstname || 'driver'}! New dispatch request available.`)
        );
      }
    });
  }

  // any -> dispatched: notify customer
  if (afterStatus === 'dispatched') {
    const csnap = await db.collection('users').where('uid', '==', data.useruid).get();
    csnap.forEach((doc) => {
      const c = doc.data();
      if (Expo.isExpoPushToken(c.pushToken)) {
        messages.push(
          makeMessage(c.pushToken, `Hi ${c.firstname || 'there'}! Your order (${data.foodItem}) is now dispatched.`)
        );
      }
    });
  }

  // dispatched -> completed: notify vendor & driver
  if (beforeStatus === 'dispatched' && afterStatus === 'completed') {
    // vendor
    const vsnap2 = await db.collection('users').where('uid', '==', data.vendoruid).get();
    vsnap2.forEach((doc) => {
      const v = doc.data();
      if (Expo.isExpoPushToken(v.pushToken)) {
        messages.push(
          makeMessage(v.pushToken, `Hi ${v.firstname || 'there'}! Order ${data.foodItem} completed. Your account has been credited.`)
        );
      }
    });
    // driver
    if (data.driveruid) {
      const dsnap2 = await db.collection('users').where('uid', '==', data.driveruid).get();
      dsnap2.forEach((doc) => {
        const dv = doc.data();
        if (Expo.isExpoPushToken(dv.pushToken)) {
          messages.push(
            makeMessage(dv.pushToken, `Hi ${dv.firstname || 'there'}! Your account has been credited.`)
          );
        }
      });
    }
  }

  if (messages.length > 0) {
    await sendPushNotifications(messages);
  }
}

}, (err) => console.error('Order listener error:', err) );

console.log('Real-time order listener active');

// 5. Daily notifications cron job async function sendDailyNotifications() { console.log('Running daily notifications'); const makeMessage = (token, body) => ({ to: token, sound: 'default', title: 'School Chow 🍔', body, data: { daily: true }, });

const roles = [ { role: 'regular_user', body: (u) => Hey ${u.firstname || 'friend'}, wetin you wan chow today? }, { role: 'vendor', body: (u) => Hi ${u.firstname || 'vendor'}, what's cooking today? }, { role: 'driver', body: (u) => Hey ${u.firstname || 'driver'}, ready for new delivery requests today? }, ];

for (const { role, body } of roles) { const snap = await db.collection('users').where('role', '==', role).get(); snap.forEach((doc) => { const u = doc.data(); if (Expo.isExpoPushToken(u.pushToken)) { sendPushNotifications([makeMessage(u.pushToken, body(u))]); } }); }

console.log('Daily notifications sent'); }

// Schedule daily at 10:17 AM Nigeria (9:17 UTC) cron.schedule('22 8 * * *', () => { console.log('Triggering daily cron at', new Date().toISOString()); sendDailyNotifications(); });

console.log('Daily notifications cron scheduled');

