// A small curated set — enough to be useful without shipping a 2MB emoji
// library. Emoji here are content people send, not decoration in the UI.

export const EMOJI_GROUPS = [
  {
    name: 'Reactions',
    emoji: ['👍', '👎', '❤️', '🎉', '🔥', '👀', '🙌', '👏', '💯', '✅', '❌', '⚠️', '🚀', '💡', '🐛', '🙏'],
  },
  {
    name: 'Faces',
    emoji: ['🙂', '😄', '😅', '😂', '😉', '😍', '🤔', '😐', '😴', '😬', '😭', '😤', '🤯', '🥳', '😎', '🤝'],
  },
  {
    name: 'Work',
    emoji: ['📌', '📝', '📅', '⏰', '⌛', '📊', '📈', '📉', '🔗', '🔍', '🔒', '🔑', '⚙️', '🛠️', '☕', '💻'],
  },
]

/** The row offered on message hover — the ones people actually use. */
export const QUICK_REACTIONS = ['👍', '❤️', '🎉', '👀', '🚀', '😂']
