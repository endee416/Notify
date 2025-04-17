// index.js
require('dotenv').config();
const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');
const cron = require('node-cron');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const expo = new Expo();

// In-memory map to track last known status per order
const lastStatusMap = {};
let initialLoadDone = false;

// Utility for sending chunks of push notifications
async function sendPushNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Ticket chunk:', ticketChunk);
    } catch (error) {
      console.error('Error sending push notifications:', error);
    }
  }
}

// Real‑time listener for order changes
console.log('[INIT] Starting Firestore listener for orders...');
db.collection('orders').onSnapshot(async snapshot => {
  // Seed the status map on initial load
  if (!initialLoadDone) {
    snapshot.docs.forEach(doc => {
      lastStatusMap[doc.id] = doc.data().status;
    });
    initialLoadDone = true;
    console.log('[INIT] Initial order statuses loaded');
    return;
  }

  // Process all modified documents
  for (const change of snapshot.docChanges()) {
    if (change.type !== 'modified') continue;

    const orderId   = change.doc.id;
    const data      = change.doc.data();
    const oldStatus = lastStatusMap[orderId];
    const newStatus = data.status;

    // Update map immediately
    lastStatusMap[orderId] = newStatus;

    // Skip if status didn’t actually change
    if (oldStatus === newStatus) continue;

    console.log(`[UPDATE] Order ${orderId} status: ${oldStatus} → ${newStatus}`);

    // Build notification messages for this transition
    const messages = [];

    switch (newStatus) {
      case 'pending': {
        // cart → pending: notify vendor
        const vendorSnap = await db.collection('users')
          .where('uid', '==', data.vendoruid).get();
        for (const doc of vendorSnap.docs) {
          const v = doc.data();
          if (Expo.isExpoPushToken(v.pushToken)) {
            messages.push({
              to: v.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${v.firstname || 'there'}! New pending order: ${data.foodItem}`,
              data: { orderId }
            });
          }
        }
        break;
      }
      case 'packaged': {
        // pending → packaged: notify unassigned drivers
        if (!data.driveruid) {
          const driversSnap = await db.collection('users')
            .where('role', '==', 'driver').get();
          for (const doc of driversSnap.docs) {
            const d = doc.data();
            if (Expo.isExpoPushToken(d.pushToken)) {
              messages.push({
                to: d.pushToken,
                sound: 'default',
                title: 'School Chow 🍔',
                body: `Hey ${d.firstname || 'driver'}! New dispatch request available.`,
                data: { orderId }
              });
            }
          }
        }
        // fall‑through to also notify customer below
      }
      case 'dispatched': {
        // packaged or dispatched → notify customer
        const custSnap = await db.collection('users')
          .where('uid', '==', data.useruid).get();
        for (const doc of custSnap.docs) {
          const c = doc.data();
          if (Expo.isExpoPushToken(c.pushToken)) {
            messages.push({
              to: c.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${c.firstname || 'there'}! Your order (${data.foodItem}) is now ${newStatus}.`,
              data: { orderId }
            });
          }
        }
        break;
      }
      case 'completed': {
        // dispatched → completed: notify vendor then driver
        const vendSnap = await db.collection('users')
          .where('uid', '==', data.vendoruid).get();
        for (const doc of vendSnap.docs) {
          const v2 = doc.data();
          if (Expo.isExpoPushToken(v2.pushToken)) {
            messages.push({
              to: v2.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${v2.firstname || 'there'}! Order ${data.foodItem} completed. Your account has been credited.`,
              data: { orderId }
            });
          }
        }
        if (data.driveruid) {
          const drSnap = await db.collection('users')
            .where('uid', '==', data.driveruid).get();
          for (const doc of drSnap.docs) {
            const d2 = doc.data();
            if (Expo.isExpoPushToken(d2.pushToken)) {
              messages.push({
                to: d2.pushToken,
                sound: 'default',
                title: 'School Chow 🍔',
                body: `Hi ${d2.firstname || 'there'}! Your delivery is complete.`,
                data: { orderId }
              });
            }
          }
        }
        break;
      }
      default:
        console.log(`[WARN] No notification handler for status "${newStatus}"`);
    }

    // Send any collected messages
    if (messages.length > 0) {
      await sendPushNotifications(messages);
    }
  }
}, error => {
  console.error('[ERROR] Order listener error:', error);
});

// Daily notifications logic
async function sendDailyNotifications() {
  console.log('[CRON] sendDailyNotifications running at', new Date().toISOString());
  // … your daily user/vendor/driver notifications …
}

// Schedule daily at 09:17 UTC (10:17 WAT)
console.log('[CRON] Scheduling daily notifications at 09:17 UTC each day');
cron.schedule('17 9 * * *', () => {
  console.log('[CRON] Triggering daily notifications at', new Date().toISOString());
  sendDailyNotifications();
});

console.log('[INIT] Notification server is up and running.');
