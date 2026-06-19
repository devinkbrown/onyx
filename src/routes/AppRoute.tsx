/**
 * AppRoute — /app shell.
 *
 * Renders the Connect screen when the user is not connected.
 * When connected, ConnectedShell (inside Connect) takes over with the
 * network name, channel list, and raw message feed.
 *
 * The full chat surface (message view, member list, DMs, settings) is a later
 * wave. This minimal slice proves the end-to-end IRC vertical: node picker →
 * CAP/SASL/registration → live message feed → channel list.
 */
import { Connect } from '../app/Connect';

export default function AppRoute() {
  return <Connect />;
}
