// SPDX-License-Identifier: AGPL-3.0-or-later
import { Mascot } from '@/components/brand/Mascot';

/** Shared closing navigation for every public Onyx route. */
export function PublicFooter() {
  return (
    <footer class="r-wrap r-footer">
      <div class="cols">
        <div class="sig">
          <div class="logo"><Mascot variant="mark" />ONYX</div>
          <p>An open network with public health, local-first memory, and honest security states.</p>
        </div>
        <div class="col"><h5>Explore</h5><a href="/">Home</a><a href="/stats/">Stats</a><a href="/status/">Status</a><a href="/roadmap/">Roadmap</a><a href="/download/">Download</a></div>
        <div class="col"><h5>Start here</h5><a href="/invite/?join=%23root">Invite to #root</a><a href="/app/">Open Onyx</a><a href="/about/">How it works</a></div>
        <div class="col"><h5>Standards</h5><a href="/accessibility/">Accessibility</a><a href="/glossary/">Glossary</a><a href="/integrations/">Integrations</a></div>
      </div>
      <div class="base"><span><Mascot variant="mark" /> Onyx — open IRC, public by default</span><span>Onyx Server · security state is shown, never assumed · 2026</span></div>
    </footer>
  );
}
