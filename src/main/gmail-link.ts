// One place for the Gmail deep link, since both stats.ts (linking Today's
// interview/assessment cards) and action-items.ts (linking a detected email)
// need it - a plain sibling import keeps neither depending on the other.

/**
 * Gmail's "open one message" deep link: a message-id search scoped to the
 * mailbox it was seen in, so it opens the exact email instead of an inbox
 * search results page. message_id arrives with angle brackets (<abc@host>);
 * Gmail's search wants the bare id.
 */
export function gmailSearchUrl(email: string, messageId: string): string {
  const bare = messageId.replace(/^</, '').replace(/>$/, '');
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email).replace(/%40/g, '@')}#search/rfc822msgid%3A${encodeURIComponent(bare)}`;
}
