/** Canonical locators — keep in sync with docs/specs/02-chatgpt-dom-contract.md */

export const SELECTORS = {
  promptTextarea: '#prompt-textarea',
  createNewChat: '[data-testid="create-new-chat-button"]',
  legacyNewChat: '[data-testid="new-chat-button"]',
  sendButton: '[data-testid="send-button"]',
  stopButton: '[data-testid="stop-button"]',
  composerPlus: '[data-testid="composer-plus-btn"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  userMessage: '[data-message-author-role="user"]',
  assistantBody: '[data-message-author-role="assistant"] .markdown.prose',
  /** Present on finished assistant turns in ChatGPT-like UIs (copy / dislike / share row). */
  copyTurn: 'button[data-testid="copy-turn-action-button"]',
  conversationTurn: 'article[data-testid^="conversation-turn"]',
  thread: '#thread',
  main: 'main#main',
} as const;
