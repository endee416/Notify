// index.js
require('dotenv').config();
const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');
const cron = require('node-cron');

// Parse the service account key from your environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const expo = new Expo();

// --------------------- ORDER POLLING LOGIC ---------------------

// Track the last time we polled Firestore. (Using new Date(0) means we process all orders on first run.)
let lastPollTime = new Date(0);

// Helper function to send push notifications using expo-server-sdk
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

async function pollOrders() {
  console.log('Polling orders for changes since', lastPollTime);
  try {
    const ordersSnapshot = await db.collection('orders').get();
    ordersSnapshot.forEach(async (doc) => {
      const order = doc.data();
      const orderId = doc.id;

      // Determine the relevant timestamp based on order status.
      let lastChangeTime = new Date(0);
      if (order.status === 'pending') {
        if (order.createdAt && order.createdAt.toDate) {
          lastChangeTime = order.createdAt.toDate();
        }
      } else if (order.status === 'packaged') {
        if (order.packagedtime && order.packagedtime.toDate) {
          lastChangeTime = order.packagedtime.toDate();
        }
      } else if (order.status === 'dispatched') {
        if (order.dispatchtime && order.dispatchtime.toDate) {
          lastChangeTime = order.dispatchtime.toDate();
        }
      } else if (order.status === 'completed') {
        if (order.dispatchtime && order.dispatchtime.toDate) {
          lastChangeTime = order.dispatchtime.toDate();
        }
      }

      // For orders not marked as completed, process only if updated since last poll.
      if (order.status !== 'completed') {
        if (lastChangeTime <= lastPollTime) return;
      } else {
        // For completed orders, if we've already notified, skip.
        if (order.notifiedCompleted) return;
      }

      // --- Notification Logic ---

      // 1. When status is 'pending': Notify the vendor.
      if (order.status === 'pending') {
        const vendorSnapshot = await db.collection('users')
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

      // 2. When status is 'packaged' and no driver is assigned: Notify all drivers.
      if (order.status === 'packaged' && (!order.driveruid || order.driveruid === '')) {
        const driversSnapshot = await db.collection('users')
          .where('role', '==', 'driver')
          .get();
        driversSnapshot.forEach(async (driverDoc) => {
          const driver = driverDoc.data();
          if (Expo.isExpoPushToken(driver.pushToken)) {
            // Message no longer includes order details.
            const messages = [{
              to: driver.pushToken,
              sound: 'default',
              body: `New dispatch request available.`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // 3. When status is 'packaged' or 'dispatched': Notify the customer.
      if (order.status === 'packaged' || order.status === 'dispatched') {
        const customerSnapshot = await db.collection('users')
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

      // 4. When status is 'completed': Notify vendor and driver.
      if (order.status === 'completed') {
        // Only process if not already notified
        if (!order.notifiedCompleted) {
          // Notify vendor (include order details)
          const vendorSnapshot = await db.collection('users')
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
          // Notify driver if assigned (message without order details)
          if (order.driveruid) {
            const driverSnapshot = await db.collection('users')
              .where('uid', '==', order.driveruid)
              .get();
            driverSnapshot.forEach(async (driverDoc) => {
              const driver = driverDoc.data();
              if (Expo.isExpoPushToken(driver.pushToken)) {
                const messages = [{
                  to: driver.pushToken,
                  sound: 'default',
                  body: `Your account has been credited.`,
                  data: { orderId }
                }];
                await sendPushNotifications(messages);
              }
            });
          }
          // Mark order as notified for completion to avoid duplicate notifications
          await updateDoc(doc.ref, { notifiedCompleted: true });
        }
      }
    });
    // After processing, update lastPollTime to now
    lastPollTime = new Date();
  } catch (error) {
    console.error('Error polling orders:', error);
  }
}

// Start polling orders every 60 seconds
setInterval(pollOrders, 60000);
console.log('Notification server started. Polling orders every 60 seconds.');

// --------------------- DAILY NOTIFICATIONS CRON JOB ---------------------

// Function to send daily notifications based on user roles
async function sendDailyNotifications() {
  try {
    console.log('Sending daily notifications...');
    // Notify regular users
    const regularSnapshot = await db.collection('users')
      .where('role', '==', 'regular_user')
      .get();
    let messages = [];
    regularSnapshot.forEach(doc => {
      const user = doc.data();
      if (Expo.isExpoPushToken(user.pushToken)) {
        messages.push({
          to: user.pushToken,
          sound: 'default',
          body: "What would you like to eat today?",
          data: { daily: true }
        });
      }
    });
    await sendPushNotifications(messages);

    // Notify vendors
    const vendorSnapshot = await db.collection('users')
      .where('role', '==', 'vendor')
      .get();
    messages = [];
    vendorSnapshot.forEach(doc => {
      const vendor = doc.data();
      if (Expo.isExpoPushToken(vendor.pushToken)) {
        messages.push({
          to: vendor.pushToken,
          sound: 'default',
          body: "What are you selling today?",
          data: { daily: true }
        });
      }
    });
    await sendPushNotifications(messages);

    // Notify drivers
    const driverSnapshot = await db.collection('users')
      .where('role', '==', 'driver')
      .get();
    messages = [];
    driverSnapshot.forEach(doc => {
      const driver = doc.data();
      if (Expo.isExpoPushToken(driver.pushToken)) {
        messages.push({
          to: driver.pushToken,
          sound: 'default',
          body: "Are you available to deliver orders today?",
          data: { daily: true }
        });
      }
    });
    await sendPushNotifications(messages);

    console.log('Daily notifications sent.');
  } catch (error) {
    console.error('Error sending daily notifications:', error);
  }
}

// Schedule the daily notifications cron job to run at 9 AM every day
cron.schedule('0 9 * * *', () => {
  console.log('Running daily notifications cron job at 9 AM.');
  sendDailyNotifications();
});

console.log('Daily notifications scheduled.');
