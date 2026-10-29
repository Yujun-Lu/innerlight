# MVP verification — October 28, 2026

The verified journey is **Speak → Feel seen → Take it with you**, entirely in English.

## Automated and build checks

- 46 automated tests passed with Node.js 24.22.1: 22 backend checks, eight client request/session checks, and 16 PCM, AudioWorklet, and microphone-resource checks.
- Full TypeScript check passed.
- Production Vinext build passed, with all five API routes and three English sample WAV files included.
- Source inspection found no client imports of provider configuration or embedded API keys. Local `.dev.vars`, runtime state, and working transcripts are ignored by Git.

## Real provider and browser checks

- Live English reflection generated from a new, fictional friend-support scenario.
- The user-facing need was edited to a quiet dinner and twenty minutes with the phone put away. The generated script included dinner, the phone, and twenty minutes.
- A new 51.13-second English WAV was generated through the application's `/api/audio` route, decoded by the browser, played for more than 36 seconds, paused, and downloaded.
- Copy reminder returned the generated takeaway text.
- Speech transcription was tested with an actual synthesized speech recording converted to the same 16 kHz mono PCM format used by the microphone recorder.
- The microphone capture implementation was reviewed; permission and a physical microphone were not manually exercised during this check.
- Three fictional sample flows returned matching reflection, script, and playable WAV assets. Sample edits were rejected, and sample content was clearly labeled.
- Mobile browser check at 390×844 showed no horizontal overflow. Sample audio decoded successfully and played.
- Desktop check at 1366×900 covered the input, editable reflection, and result views.
- The always-visible support link opened and focused real-world support information. Explicit immediate-danger input paused the normal meditation flow.

## Audio transcription verification

Actual WAV files were transcribed through the ASR endpoint and compared to their source scripts. Automatic transcription is an additional fidelity check, not a complete subjective listening review.

| Recording | Duration | Word error rate |
| --- | ---: | ---: |
| Giving too much | 61.81 s | 0.47% |
| Waiting for a reply | 64.26 s | 0.00% |
| Feeling directionless | 67.85 s | 0.93% |
| New personalized session | 51.13 s | 0.64% |

## Visual evidence

- `home-desktop.jpg`
- `live-result-desktop.jpg`
- `sample-result-mobile.jpg`

## Polished release verification

- Warm frosted-glass surfaces, soft amber halos, bounded light particles, and a dark forest focus listening room are implemented in CSS and SVG-compatible browser elements.
- Browser layout checks at 1366, 683, 375, and 320 pixels showed no horizontal page overflow. Reduced-motion emulation disabled particle animation. Browser zoom shortcuts were unavailable; a separate 200% browser-zoom check was not completed.
- A new live session accepted an edited dinner/phone-boundary need with its suggested demand skipped. It produced a playable 78.98-second WAV through the real provider.
- Browser playback, keyboard seeking, 15-second skip, 0.9× playback, pause, focus entry, Escape exit, and focus restoration worked. The focus room and main page share one audio element.
- Optional local ambience enabled successfully, followed playback, and turned off on returning to edit.
- Copy returned the expected title and reminder. Audio downloaded as WAV. A 1200 × 1500 PNG reminder downloaded and was visually inspected for complete, unclipped text.
- Returning to a previous generated reflection preserved a newer live draft while another sample was selected. The result remained labeled as a previous personalized reflection. Reset confirmation retained the newer live draft.
- A separate hook harness passed six cached-result checks with mocked network requests; a prior six-check harness covered cancellation, stale results, unavailable service, and draft preservation.
- The production build and launcher syntax check passed. A scan of 213 source/build text files found no exact configured API-key values.
- The generated narration review prompted a stricter instruction against invented bodily sensations, assertions of safety, predictions of others' reactions, and unchosen commitments in boundary drafts. Generated prose still requires human judgment; prompt instructions are not an efficacy guarantee.

Polished visual evidence: `polish-home-desktop.jpg`, `polish-home-mobile.jpg`, `polish-result-desktop.jpg`, `polish-result-mobile.jpg`, `polish-focus-desktop.jpg`, and `polish-reminder-card.png`.

This validates the prototype's implementation and demo path. It does not establish clinical effectiveness.
