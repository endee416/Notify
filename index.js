
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

let lastPollTime = new Date(0);

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
        if (order.completetime && order.completetime.toDate) {
          lastChangeTime = order.completetime.toDate();
        }
      }

      if (lastChangeTime <= lastPollTime) return;

      // Notification Logic
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
              title: 'School Chow 🍔',
              body: `Hi ${vendor.firstname || 'there'}! New pending order: ${order.foodItem}`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // 2. When status is 'packaged' and no driver assigned: Notify all drivers.
      if (order.status === 'packaged' && (!order.driveruid || order.driveruid === '')) {
        const driversSnapshot = await db.collection('users')
          .where('role', '==', 'driver')
          .get();
        driversSnapshot.forEach(async (driverDoc) => {
          const driver = driverDoc.data();
          if (Expo.isExpoPushToken(driver.pushToken)) {
            const messages = [{
              to: driver.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hey ${driver.firstname || 'driver'}! New dispatch request available.`,
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
              title: 'School Chow 🍔',
              body: `Hi ${customer.firstname || 'there'}! Your order (${order.foodItem}) is now ${order.status}.`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
      }

      // 4. When status is 'completed': Notify vendor and driver.
      if (order.status === 'completed') {
        // Notify vendor
        const vendorSnapshot = await db.collection('users')
          .where('uid', '==', order.vendoruid)
          .get();
        vendorSnapshot.forEach(async (vendorDoc) => {
          const vendor = vendorDoc.data();
          if (Expo.isExpoPushToken(vendor.pushToken)) {
            const messages = [{
              to: vendor.pushToken,
              sound: 'default',
              title: 'School Chow 🍔',
              body: `Hi ${vendor.firstname || 'there'}! Order ${order.foodItem} completed. Your account has been credited.`,
              data: { orderId }
            }];
            await sendPushNotifications(messages);
          }
        });
        // Notify driver if assigned
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
                title: 'School Chow 🍔',
                body: `Hi ${driver.firstname || 'there'}! Your account has been credited.`,
                data: { orderId }
              }];
              await sendPushNotifications(messages);
            }
          });
        }
      }
    });
    lastPollTime = new Date();
  } catch (error) {
    console.error('Error polling orders:', error);
  }
}

setInterval(pollOrders, 7200000);
console.log('Notification server started. Polling orders every 2 hours.');

// --------------------- DAILY NOTIFICATIONS CRON JOB ---------------------

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
          title: 'School Chow 🍔',
          body: `Hey ${user.firstname || 'friend'}, what would you like to eat today?`,
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
          title: 'School Chow 🍔',
          body: `Hi ${vendor.firstname || 'vendor'}, what's cooking today?`,
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
          title: 'School Chow 🍔',
          body: `Hey ${driver.firstname || 'driver'}, ready for new delivery requests today?`,
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

// Schedule the daily notifications cron job to run at 10:05 AM Nigeria time (9:05 AM UTC)
cron.schedule('20 15 * * *', () => {
  console.log('Running daily notifications cron job at 9:05 UTC (10:05 Nigeria time).');
  sendDailyNotifications();
});

console.log('Daily notifications scheduled.');
