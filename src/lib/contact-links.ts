// The Call and WhatsApp buttons on the profile, Update follow-up and the Today cards.
// They open the phone's own dialer and the salesperson's own WhatsApp; nothing is ever
// sent by itself. The store's template choice arrives with M22.

// Stored mobiles are 10 digits (src/lib/mobile.ts); India's country code goes in front.
export function telHref(mobile: string): string {
  return `tel:+91${mobile}`;
}

export function whatsappHref(mobile: string): string {
  return `https://wa.me/91${mobile}`;
}
