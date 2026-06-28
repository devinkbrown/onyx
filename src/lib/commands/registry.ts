export type SlashCommandKind = 'irc' | 'text';

export type SlashCommand = {
  name: string;
  usage: string;
  description: string;
  kind: SlashCommandKind;
  aliases?: readonly string[];
  insertText?: string;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'me', usage: '/me <action>', description: 'Send an action message.', kind: 'irc' },
  { name: 'topic', usage: '/topic <text>', description: 'Set or view the channel topic.', kind: 'irc' },
  { name: 'nick', usage: '/nick <nick>', description: 'Change your nick.', kind: 'irc' },
  { name: 'join', usage: '/join #channel', description: 'Join a channel.', kind: 'irc', aliases: ['j'] },
  { name: 'part', usage: '/part [#channel]', description: 'Leave the current or named channel.', kind: 'irc', aliases: ['leave'] },
  { name: 'msg', usage: '/msg <nick> <text>', description: 'Send a private message.', kind: 'irc', aliases: ['query'] },
  { name: 'whois', usage: '/whois <nick>', description: 'Request user information.', kind: 'irc' },
  { name: 'invite', usage: '/invite <nick>', description: 'Invite someone into the channel.', kind: 'irc' },
  { name: 'shrug', usage: '/shrug', description: 'Insert a shrug.', kind: 'text', insertText: String.raw`¯\_(ツ)_/¯` },
  { name: 'tableflip', usage: '/tableflip', description: 'Insert a table flip.', kind: 'text', insertText: '(╯°□°）╯︵ ┻━┻' },
];

export function slashCommandQuery(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.startsWith('//')) return null;
  const firstToken = text.slice(1).split(/\s/, 1)[0] ?? '';
  if (firstToken.length === 0) return '';
  if (/\s/.test(text.slice(1, firstToken.length + 2))) return null;
  return firstToken.toLowerCase();
}

export function findSlashCommand(name: string): SlashCommand | null {
  const needle = name.replace(/^\//, '').toLowerCase();
  return SLASH_COMMANDS.find((command) =>
    command.name === needle || command.aliases?.includes(needle),
  ) ?? null;
}

export function getSlashCommandSuggestions(text: string, limit = 8): SlashCommand[] {
  const query = slashCommandQuery(text);
  if (query === null) return [];

  const matches = SLASH_COMMANDS.filter((command) => {
    if (command.name.startsWith(query)) return true;
    return command.aliases?.some((alias) => alias.startsWith(query)) ?? false;
  });

  return matches.slice(0, limit);
}

export function completeSlashCommand(input: string, command: SlashCommand): string {
  const rest = input.replace(/^\/\S*/, '').trimStart();
  if (command.kind === 'text' && command.insertText) {
    return rest ? `${command.insertText} ${rest}` : command.insertText;
  }
  const completed = `/${command.name}`;
  return rest ? `${completed} ${rest}` : `${completed} `;
}

export function expandSlashTextCommand(input: string): string {
  const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return input;
  const command = findSlashCommand(match[1] ?? '');
  if (!command || command.kind !== 'text' || !command.insertText) return input;
  const suffix = match[2]?.trim();
  return suffix ? `${command.insertText} ${suffix}` : command.insertText;
}
