// The Call and WhatsApp buttons on the profile, Update follow-up and the Today cards.
// They open the phone's own dialer and the salesperson's own WhatsApp, where they type
// the message themselves. Nothing is ever sent by the app (decided 25 Sep 2026: no
// WhatsApp Business API, no templates).

// Stored mobiles are 10 digits (src/lib/mobile.ts); India's country code goes in front.
export function telHref(mobile: string): string {
  return `tel:+91${mobile}`;
}

export function whatsappHref(mobile: string): string {
  return `https://wa.me/91${mobile}`;
}
