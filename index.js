// index.js
require('dotenv').config();
const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');

// Parse the service account key from the environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Optionally, add your databaseURL if needed
  // databaseURL: "https://your-project.firebaseio.com"
});

const db = admin.firestore();

// Create a new Expo SDK client
let expo = new Expo();

// Helper function to send push notifications using expo-server-sdk
async function sendPushNotifications(messages) {
  let chunks = expo.chunkPushNotifications(messages);
  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Ticket chunk:', ticketChunk);
    } catch (error) {
      console.error('Error sending push notifications:', error);
    }
  }
}

// Poll orders from Firestore every 60 seconds and send notifications based on status changes.
async function pollOrders() {
  console.log('Polling orders for status changes...');
  try {
    const ordersSnapshot = await db.collection('orders').get();
    ordersSnapshot.forEach(async (doc) => {
      const order = doc.data();
      const orderId = doc.id;

      // When status changes to 'pending': Notify the vendor.
      if (order.status === 'pending') {
        const vendorSnapshot = await db
          .collection('users')
          .where('uid', '==', order.vendoruid)
          .get();
        vendorSnapshot.forEach(async (vendorDoc) => {
          const vendor = vendorDoc.data();
          if (Expo.isExpoPushToken(vendor.pushToken)) {
            const messages = [{
              to: vendor.pushToken,
              sound: 'default',
              body: `New pending order: ${order.foodItem}`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // When status changes to 'packaged' and driveruid is empty: Notify all drivers.
      if (order.status === 'packaged' && (!order.driveruid || order.driveruid === '')) {
        const driversSnapshot = await db
          .collection('users')
          .where('role', '==', 'driver')
          .get();
        driversSnapshot.forEach(async (driverDoc) => {
          const driver = driverDoc.data();
          if (Expo.isExpoPushToken(driver.pushToken)) {
            const messages = [{
              to: driver.pushToken,
              sound: 'default',
              body: `New dispatch request for order: ${order.foodItem}`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // When status changes to 'packaged' or 'dispatched': Notify the customer.
      if (order.status === 'packaged' || order.status === 'dispatched') {
        const customerSnapshot = await db
          .collection('users')
          .where('uid', '==', order.useruid)
          .get();
        customerSnapshot.forEach(async (customerDoc) => {
          const customer = customerDoc.data();
          if (Expo.isExpoPushToken(customer.pushToken)) {
            const messages = [{
              to: customer.pushToken,
              sound: 'default',
              body: `Your order (${order.foodItem}) is now ${order.status}`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // When status changes to 'completed': Notify both vendor and driver.
      if (order.status === 'completed') {
        // Notify vendor
        const vendorSnapshot = await db
          .collection('users')
          .where('uid', '==', order.vendoruid)
          .get();
        vendorSnapshot.forEach(async (vendorDoc) => {
          const vendor = vendorDoc.data();
          if (Expo.isExpoPushToken(vendor.pushToken)) {
            const messages = [{
              to: vendor.pushToken,
              sound: 'default',
              body: `Order ${order.foodItem} completed. Your account has been credited.`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
        // Notify driver, if assigned
        if (order.driveruid) {
          const driverSnapshot = await db
            .collection('users')
            .where('uid', '==', order.driveruid)
            .get();
          driverSnapshot.forEach(async (driverDoc) => {
            const driver = driverDoc.data();
            if (Expo.isExpoPushToken(driver.pushToken)) {
              const messages = [{
                to: driver.pushToken,
                sound: 'default',
                body: `Order ${order.foodItem} completed. Your account has been credited.`,
                data: { orderId }
              }];
              await sendPushNotifications(messages);
            }
          });
        }
      }
    });
  } catch (error) {
    console.error('Error polling orders:', error);
  }
}

// Poll orders every 60 seconds
setInterval(pollOrders, 60000);
console.log('Notification server started. Polling every 60 seconds.');
