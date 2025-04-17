// index.js require('dotenv').config(); const admin = require('firebase-admin'); const { Expo } = require('expo-server-sdk'); const cron = require('node-cron');

// Initialize Firebase Admin const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore(); const expo = new Expo();

// Utility for sending chunks of push notifications async function sendPushNotifications(messages) { const chunks = expo.chunkPushNotifications(messages); for (const chunk of chunks) { try { const ticketChunk = await expo.sendPushNotificationsAsync(chunk); console.log('Ticket chunk:', ticketChunk); } catch (error) { console.error('Error sending push notifications:', error); } } }

// Real-time listener for order updates const unsubscribeOrders = db.collection('orders') .onSnapshot( snapshot => { snapshot.docChanges().forEach(change => { const order = change.doc.data(); const orderId = change.doc.id;

if (change.type === 'added') {
      // Handle new orders if needed
    }

    if (change.type === 'modified') {
      const beforeData = change.before.data();
      const afterData = change.after.data();
      if (beforeData.status !== afterData.status) {
        // Notification logic based on new status
        (async () => {
          const status = afterData.status;
          let usersSnapshot;

          switch (status) {
            case 'pending':
              usersSnapshot = await db.collection('users')
                .where('uid', '==', afterData.vendoruid)
                .get();
              usersSnapshot.forEach(doc => {
                const vendor = doc.data();
                if (Expo.isExpoPushToken(vendor.pushToken)) {
                  sendPushNotifications([{
                    to: vendor.pushToken,
                    sound: 'default',
                    title: 'School Chow 🍔',
                    body: `Hi ${vendor.firstname || 'there'}! New pending order: ${afterData.foodItem}`,
                    data: { orderId }
                  }]);
                }
              });
              break;
            case 'packaged':
              if (!afterData.driveruid) {
                usersSnapshot = await db.collection('users')
                  .where('role', '==', 'driver')
                  .get();
                usersSnapshot.forEach(doc => {
                  const driver = doc.data();
                  if (Expo.isExpoPushToken(driver.pushToken)) {
                    sendPushNotifications([{
                      to: driver.pushToken,
                      sound: 'default',
                      title: 'School Chow 🍔',
                      body: `Hey ${driver.firstname || 'driver'}! New dispatch request available.`,
                      data: { orderId }
                    }]);
                  }
                });
              }
              break;
            case 'dispatched':
            case 'packaged':
              usersSnapshot = await db.collection('users')
                .where('uid', '==', afterData.useruid)
                .get();
              usersSnapshot.forEach(doc => {
                const customer = doc.data();
                if (Expo.isExpoPushToken(customer.pushToken)) {
                  sendPushNotifications([{
                    to: customer.pushToken,
                    sound: 'default',
                    title: 'School Chow 🍔',
                    body: `Hi ${customer.firstname || 'there'}! Your order (${afterData.foodItem}) is now ${status}.`,
                    data: { orderId }
                  }]);
                }
              });
              break;
            case 'completed':
              // Notify vendor
              usersSnapshot = await db.collection('users')
                .where('uid', '==', afterData.vendoruid)
                .get();
              usersSnapshot.forEach(doc => {
                const vendor = doc.data();
                if (Expo.isExpoPushToken(vendor.pushToken)) {
                  sendPushNotifications([{
                    to: vendor.pushToken,
                    sound: 'default',
                    title: 'School Chow 🍔',
                    body: `Hi ${vendor.firstname || 'there'}! Order ${afterData.foodItem} completed. Your account has been credited.`,
                    data: { orderId }
                  }]);
                }
              });
              // Notify driver if assigned
              if (afterData.driveruid) {
                usersSnapshot = await db.collection('users')
                  .where('uid', '==', afterData.driveruid)
                  .get();
                usersSnapshot.forEach(doc => {
                  const driver = doc.data();
                  if (Expo.isExpoPushToken(driver.pushToken)) {
                    sendPushNotifications([{
                      to: driver.pushToken,
                      sound: 'default',
                      title: 'School Chow 🍔',
                      body: `Hi ${driver.firstname || 'there'}! Your account has been credited.`,
                      data: { orderId }
                    }]);
                  }
                });
              }
              break;
            default:
              break;
          }
        })();
      }
    }
  });
},
error => console.error('Order listener error:', error)

);

// Daily notifications cron job async function sendDailyNotifications() { console.log('Sending daily notifications...'); // Daily logic here (unchanged) }

// Run daily notifications at 9:17 UTC (10:17 Nigeria time) cron.schedule('17 9 * * *', () => { console.log('Daily notifications triggered at', new Date()); sendDailyNotifications(); });

console.log('Notification server started. Listening for order changes and daily tasks.');

