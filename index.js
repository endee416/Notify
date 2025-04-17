// index.js require('dotenv').config(); const admin = require('firebase-admin'); const { Expo } = require('expo-server-sdk'); const cron = require('node-cron');

// Initialize Firebase Admin const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore(); const expo = new Expo();

// In-memory map to track last known status per order const lastStatusMap = {};

// Utility for sending chunks of push notifications async function sendPushNotifications(messages) { const chunks = expo.chunkPushNotifications(messages); for (const chunk of chunks) { try { const ticketChunk = await expo.sendPushNotificationsAsync(chunk); console.log('Ticket chunk:', ticketChunk); } catch (error) { console.error('Error sending push notifications:', error); } } }

// Real-time listener for order updates db.collection('orders').onSnapshot( snapshot => { snapshot.docChanges().forEach(async change => { if (change.type === 'modified') { const order = change.doc.data(); const orderId = change.doc.id; const newStatus = order.status; const oldStatus = lastStatusMap[orderId];

if (newStatus && newStatus !== oldStatus) {
      lastStatusMap[orderId] = newStatus;

      let usersSnapshot;
      // Determine notification recipients based on status
      switch (newStatus) {
        case 'pending':
          usersSnapshot = await db.collection('users').where('uid', '==', order.vendoruid).get();
          for (const doc of usersSnapshot.docs) {
            const vendor = doc.data();
            if (Expo.isExpoPushToken(vendor.pushToken)) {
              await sendPushNotifications([{ to: vendor.pushToken, sound: 'default', title: 'School Chow 🍔', body: `Hi ${vendor.firstname||'there'}! New pending order: ${order.foodItem}`, data: { orderId } }]);
            }
          }
          break;
        case 'packaged':
          if (!order.driveruid) {
            usersSnapshot = await db.collection('users').where('role', '==', 'driver').get();
            for (const doc of usersSnapshot.docs) {
              const driver = doc.data();
              if (Expo.isExpoPushToken(driver.pushToken)) {
                await sendPushNotifications([{ to: driver.pushToken, sound: 'default', title: 'School Chow 🍔', body: `Hey ${driver.firstname||'driver'}! New dispatch request available.`, data: { orderId } }]);
              }
            }
          }
          break;
        case 'dispatched':
        case 'packaged':
          usersSnapshot = await db.collection('users').where('uid', '==', order.useruid).get();
          for (const doc of usersSnapshot.docs) {
            const customer = doc.data();
            if (Expo.isExpoPushToken(customer.pushToken)) {
              await sendPushNotifications([{ to: customer.pushToken, sound: 'default', title: 'School Chow 🍔', body: `Hi ${customer.firstname||'there'}! Your order (${order.foodItem}) is now ${newStatus}.`, data: { orderId } }]);
            }
          }
          break;
        case 'completed':
          // Notify vendor
          usersSnapshot = await db.collection('users').where('uid', '==', order.vendoruid).get();
          for (const doc of usersSnapshot.docs) {
            const vendor = doc.data();
            if (Expo.isExpoPushToken(vendor.pushToken)) {
              await sendPushNotifications([{ to: vendor.pushToken, sound: 'default', title: 'School Chow 🍔', body: `Hi ${vendor.firstname||'there'}! Order ${order.foodItem} completed. Your account has been credited.`, data: { orderId } }]);
            }
          }
          // Notify driver
          if (order.driveruid) {
            usersSnapshot = await db.collection('users').where('uid', '==', order.driveruid).get();
            for (const doc of usersSnapshot.docs) {
              const driver = doc.data();
              if (Expo.isExpoPushToken(driver.pushToken)) {
                await sendPushNotifications([{ to: driver.pushToken, sound: 'default', title: 'School Chow 🍔', body: `Hi ${driver.firstname||'there'}! Your account has been credited.`, data: { orderId } }]);
              }
            }
          }
          break;
        default:
          break;
      }
    }
  }
});

}, error => console.error('Order listener error:', error) );

// Daily notifications cron job async function sendDailyNotifications() { console.log('Sending daily notifications...'); // ... your daily logic here ... }

// Schedule daily at 9:17 UTC cron.schedule('17 9 * * *', () => { console.log('Daily notifications triggered at', new Date()); sendDailyNotifications(); });

console.log('Notification server started: listening for order changes and daily tasks.');

