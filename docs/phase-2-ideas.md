# Phase 2 Ideas & Future Backlog

This document captures features, enhancements, and operational improvements deferred from the Phase 1 MVP to keep initial launch focused, reliable, and simple.

---

## 1. Payments & Checkout
- **UPI & Online Payments (Razorpay / Cashfree)**:
  - Add instant UPI QR code and payment gateway support.
  - Retain COD as an option or require prepayment for express delivery.
  - Automated refunds upon order cancellation.
- **Dynamic Delivery Fees**:
  - Distance or weather-based surge pricing for express orders during monsoon/late-night hours.

## 2. Customer Experience & Communication
- **Automated WhatsApp Notifications**:
  - Automatically send order confirmations and ETA updates to the customer's WhatsApp via the WhatsApp Business API.
- **Web Push Notifications**:
  - Add Service Worker with Web Push notifications for real-time alerts when the order is "Out for delivery" or "Food arrived at gate".
- **Customer Accounts & Address Book**:
  - Optional OTP-based login (no passwords) to save room numbers and phone numbers across sessions.

## 3. Abuse Prevention & Fraud Protection
- **Phone Number OTP Verification**:
  - Require a 4-digit SMS OTP on checkout if prank or uncollected COD orders exceed acceptable thresholds.
- **Reputation Tracking**:
  - Flag phone numbers with history of uncollected COD orders for admin review or mandatory prepayment.

## 4. Vendor Operations & Staff Management
- **Morning Stock Reminder**:
  - Scheduled automated SMS/WhatsApp at 11:30 AM IST if today's stock has not been updated yet.
- **Delivery Staff Role**:
  - Restricted "Driver / Delivery boy" view that displays only customer name, room, and "Cash Collected" button without access to menu prices, settings, or credentials.
- **Kitchen Display / Thermal Receipt Printer**:
  - Bluetooth thermal printer support (58mm/80mm) to print kitchen tickets directly from the browser upon order arrival.

## 5. Analytics & Reporting
- **Business Intelligence**:
  - Daily, weekly, and monthly revenue breakdown.
  - Most popular items and sell-out time velocity (which items sell out earliest).
  - Average preparation and delivery times for express orders.
- **Inventory Forecasts**:
  - Recommending daily preparation quantities based on day-of-week historical demand (e.g. higher biryani demand on Friday/Saturday).
