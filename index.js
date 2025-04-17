// index.js require('dotenv').config(); const admin = require('firebase-admin'); const { Expo } = require('expo-server-sdk'); const cron = require('node-cron');

// Initialize Firebase Admin SDK const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore(); const expo = new Expo();

// --------------------- REAL-TIME ORDER LISTENER ---------------------

async function sendPushNotifications(messages) { const chunks = expo.chunkPushNotifications(messages); for (const chunk of chunks) { try { const ticketChunk = await expo.sendPushNotificationsAsync(chunk); console.log('Ticket chunk:', ticketChunk); } catch (error) { console.error('Error sending push notifications:', error); } } }

// Listen for changes on the 'orders' collection const unsubscribeOrders = db.collection('orders') .onSnapshot(snapshot => { snapshot.docChanges().forEach(change => { if (change.type === 'modified') { const order = change.doc.data(); const orderId = change.doc.id; // Only trigger when status field changed const before = change.oldIndex >= 0 ? snapshot.docs[change.oldIndex].data() : null; if (before && before.status === order.status) return;

// Notification logic based on order.status
    (async () => {
      // 1. Pending -> vendor
      if (order.status === 'pending') {
        const vendorSnap = await db.collection('users').where('uid','==',order.vendoruid).get();
        vendorSnap.forEach(doc => {
          const vendor = doc.data();
          if (Expo.isExpoPushToken(vendor.pushToken)) {
            sendPushNotifications([{
              to: vendor.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${vendor.firstname||'there'}! New pending order: ${order.foodItem}`,
              data: { orderId }
            }]);
          }
        });
      }
      // 2. Packaged & no driver -> drivers
      if (order.status === 'packaged' && (!order.driveruid || order.driveruid === '')) {
        const driversSnap = await db.collection('users').where('role','==','driver').get();
        driversSnap.forEach(doc => {
          const driver = doc.data();
          if (Expo.isExpoPushToken(driver.pushToken)) {
            sendPushNotifications([{
              to: driver.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hey ${driver.firstname||'driver'}! New dispatch request available.`,
              data: { orderId }
            }]);
          }
        });
      }
      // 3. Packaged or Dispatched -> customer
      if (['packaged','dispatched'].includes(order.status)) {
        const custSnap = await db.collection('users').where('uid','==',order.useruid).get();
        custSnap.forEach(doc => {
          const cust = doc.data();
          if (Expo.isExpoPushToken(cust.pushToken)) {
            sendPushNotifications([{
              to: cust.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${cust.firstname||'there'}! Your order (${order.foodItem}) is now ${order.status}.`,
              data: { orderId }
            }]);
          }
        });
      }
      // 4. Completed -> vendor and driver
      if (order.status === 'completed') {
        // vendor
        const vendSnap = await db.collection('users').where('uid','==',order.vendoruid).get();
        vendSnap.forEach(doc => {
          const vend = doc.data();
          if (Expo.isExpoPushToken(vend.pushToken)) {
            sendPushNotifications([{
              to: vend.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${vend.firstname||'there'}! Order ${order.foodItem} completed. Your account has been credited.`,
              data: { orderId }
            }]);
          }
        });
        // driver
        if (order.driveruid) {
          const drvSnap = await db.collection('users').where('uid','==',order.driveruid).get();
          drvSnap.forEach(doc => {
            const drv = doc.data();
            if (Expo.isExpoPushToken(drv.pushToken)) {
              sendPushNotifications([{
                to: drv.pushToken,
                sound: 'default',
                title: 'School Chow 🍔',
                body: `Hi ${drv.firstname||'there'}! Your account has been credited.`,
                data: { orderId }
              }]);
            }
          });
        }
      }
    })();
  }
});

}, error => console.error('Order listener error:', error));

// --------------------- DAILY NOTIFICATIONS CRON JOB ---------------------

async function sendDailyNotifications() { try { console.log('Sending daily notifications...'); // (same as before) // ... regular users, vendors, drivers notifications ... } catch (error) { console.error('Error sending daily notifications:', error); } }

// Schedule the daily notifications cron job to run at 10:17 AM Nigeria time (9:17 AM UTC) cron.schedule('17 9 * * *', () => { console.log('Running daily notifications cron job at 9:17 UTC (10:17 Nigeria time).'); sendDailyNotifications(); });

console.log('Notification server started. Listening for order changes.');

              
