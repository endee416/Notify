// index.js
require('dotenv').config();
const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');
const cron = require('node-cron');

// 1. Init Firebase Admin with your FCM v1 service account
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// 2. Instantiate Expo for FCM v1
const expo = new Expo({ useFcmV1: true });

// 3. Helper: send push notifications in chunks
async function sendPushNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log('Push tickets:', tickets);
    } catch (error) {
      console.error('Push error:', error);
    }
  }
}

// 4. Real‑time listener for order status changes
const lastStatusMap = new Map();
let isInitialLoad = true;

db.collection('orders').onSnapshot(
  async (snapshot) => {
    if (isInitialLoad) {
      // Cache initial statuses so we don’t fire on existing data
      snapshot.docs.forEach(doc =>
        lastStatusMap.set(doc.id, doc.data().status)
      );
      isInitialLoad = false;
      console.log('Initial order status cache populated');
      return;
    }

    for (const change of snapshot.docChanges()) {
      if (change.type !== 'modified') continue;

      const orderId = change.doc.id;
      const data = change.doc.data();
      const afterStatus = data.status;

      // ★ default any missing "before" to 'cart'
      const beforeStatus = lastStatusMap.has(orderId)
        ? lastStatusMap.get(orderId)
        : 'cart';

      // update cache
      lastStatusMap.set(orderId, afterStatus);

      if (beforeStatus === afterStatus) continue;
      console.log(`Order ${orderId} status changed: ${beforeStatus} → ${afterStatus}`);

      const messages = [];
      const makeMsg = (token, body) => ({
        to: token,
        channelId: 'default',
        sound: 'default',
        title: 'School Chow 🍔',
        body,
        data: { orderId },
      });

      // cart → pending: notify vendor with custom sound/channel
      if (beforeStatus === 'cart' && afterStatus === 'pending') {
        const vsnap = await db.collection('users')
          .where('uid', '==', data.vendoruid)
          .get();
        vsnap.forEach(doc => {
          const u = doc.data();
          if (Expo.isExpoPushToken(u.pushToken)) {
            messages.push({
              to: u.pushToken,
              channelId: 'default', // Android channel
              sound: 'chow.wav',    // custom sound
              title: 'School Chow 🍔',
              body: `Hi ${u.firstname || 'there'}! New pending order: ${data.foodItem}`,
              data: { orderId },
            });
          }
        });
      }

      // pending → packaged (no driver): notify all drivers with custom sound
      if (beforeStatus === 'pending' && afterStatus === 'packaged' && !data.driveruid) {
        const dsnap = await db.collection('users')
          .where('role', '==', 'driver')
          .get();
        dsnap.forEach(doc => {
          const d = doc.data();
          if (Expo.isExpoPushToken(d.pushToken)) {
            messages.push({
              to: d.pushToken,
              channelId: 'default', // Android channel
              sound: 'chow.wav',    // custom sound
              title: 'School Chow 🍔',
              body: `Hey ${d.firstname || 'driver'}! New dispatch request available.`,
              data: { orderId },
            });
          }
        });
      }

      // any → dispatched: notify customer
      if (afterStatus === 'dispatched') {
        const csnap = await db.collection('users')
          .where('uid', '==', data.useruid)
          .get();
        csnap.forEach(doc => {
          const c = doc.data();
          if (Expo.isExpoPushToken(c.pushToken)) {
            messages.push(
              makeMsg(c.pushToken, `Your order (${data.foodItem}) is now dispatched.`)
            );
          }
        });
      }

      // dispatched → completed: notify vendor + driver
      if (beforeStatus === 'dispatched' && afterStatus === 'completed') {
        // vendor
        const vsnap2 = await db.collection('users')
          .where('uid', '==', data.vendoruid)
          .get();
        vsnap2.forEach(doc => {
          const v = doc.data();
          if (Expo.isExpoPushToken(v.pushToken)) {
            messages.push(
              makeMsg(v.pushToken, `Order ${data.foodItem} completed. Your account has been credited.`)
            );
          }
        });
        // driver
        if (data.driveruid) {
          const dsnap2 = await db.collection('users')
            .where('uid', '==', data.driveruid)
            .get();
          dsnap2.forEach(doc => {
            const dv = doc.data();
            if (Expo.isExpoPushToken(dv.pushToken)) {
              messages.push(
                makeMsg(dv.pushToken, `Your account has been credited.`)
              );
            }
          });
        }
      }

      if (messages.length > 0) {
        await sendPushNotifications(messages);
      }
    }
  },
  (error) => {
    console.error('Order listener error:', error);
  }
);

console.log('Real-time order listener active');

// 5. Daily notifications cron job
async function sendDailyNotifications() {
  console.log('Running daily notifications');

  const makeDaily = (token, body) => ({
    to: token,
    channelId: 'default',
    sound: 'default',
    title: 'School Chow 🍔',
    body,
    data: { daily: true },
  });

  const roles = [
    { role: 'regular_user', msg: u => `Yo ${u.firstname || 'friend'}, Our kitchen had a techy tummy ache… but we’ve rebooted the stove! School Chow is back online and hotter than fresh jollof. Let’s chow like nothing happened!` },
    { role: 'vendor',       msg: u => `Yo ${u.firstname || 'vendor'}, Our kitchen had a techy tummy ache… but we’ve rebooted the stove! School Chow is back online and hotter than fresh jollof. Let’s chow like nothing happened!` },
    { role: 'driver',       msg: u => `Yo ${u.firstname || 'driver'}, Our kitchen had a techy tummy ache… but we’ve rebooted the stove! School Chow is back online and hotter than fresh jollof. Let’s chow like nothing happened!` },
  ];

  for (const { role, msg } of roles) {
    const snap = await db.collection('users').where('role', '==', role).get();
    snap.forEach(doc => {
      const u = doc.data();
      if (Expo.isExpoPushToken(u.pushToken)) {
        sendPushNotifications([ makeDaily(u.pushToken, msg(u)) ]);
      }
    });
  }

  console.log('Daily notifications sent');
}

// Schedule at 10:17 AM Nigeria (9:17 UTC)
cron.schedule('51 14 * * *', () => {
  console.log('Cron triggered at', new Date().toISOString());
  sendDailyNotifications();
});

console.log('Daily notifications cron scheduled');

