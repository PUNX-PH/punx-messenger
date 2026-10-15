# Sound effects

Nine short sounds, the same on the web and Android apps.

| Sound | Plays when |
|---|---|
| `ring` (loops) | A call comes in. Stops when it is answered, declined, or the caller gives up. |
| `ringback` (loops) | You are calling and it is ringing at the other end. |
| `call_connected` | A call connects. |
| `call_ended` | A call you were in ends, or one you placed went nowhere (declined, unanswered, cancelled). An incoming call that simply stops ringing is silent. |
| `dm_ping` | A new DM arrives — not for the conversation you have open, not for your own messages. On Android only while the app is in front; in the background the system notification speaks. |
| `voice_join` / `voice_leave` | You get into / leave a voice channel. A join that fails makes no sound. |
| `peer_join` / `peer_leave` | Someone else joins / leaves the channel you are in. Quiet. Not for the people already there when you join, and not while you are deafened. |

Sound can be switched off per device: the gear menu on the web ("Sound effects"), the profile sheet on Android. On by default. Turning it on plays a ping so you can tell it works.

## Where it lives

| | Web | Android |
|---|---|---|
| The sounds | `public/sfx/*.wav` | `android_app/assets/sfx/*.wav` |
| Player | `src/lib/sfx.js` | `lib/services/sfx_service.dart` |
| When each plays (pure rules) | `src/lib/sfxRules.js` | `lib/services/sfx_rules.dart` |
| Call sounds | `components/calls/CallManager.jsx` | `widgets/shared/sfx_daemon.dart` |
| DM ping | `lib/notifications.jsx` | `services/notification_listener_service.dart` |
| Voice sounds | `lib/useVoiceChannel.jsx` | `providers/voice_channel_providers.dart` |

The two `*Rules` files are the same rules in two languages; change one, change the other.

## Changing a sound

The WAVs are generated, not recorded: `scripts/generate-sfx.mjs` holds every sound as a few notes, and writes both copies.

```bash
node scripts/generate-sfx.mjs      # after editing SOUNDS in that file
node --test tests/sfx.test.mjs     # checks the audio itself
```

`tests/sfx.test.mjs` reads the files back and checks what makes a sound good or bad: no clicks (it starts and ends at silence), loops end in silence so they repeat without a seam, the right pitches, "join" rises and "leave" falls, and nothing is louder than its stated gain. It also fails if the committed files differ from what the script produces, so the two cannot drift.

To use your own recordings instead, replace the files in **both** folders under the same names (keep the two copies identical; `test/services/sfx_service_test.dart` checks they are). Loops (`ring`, `ringback`) must end in a moment of silence or they will click when they repeat.

## Things worth knowing

- **Autoplay (web).** A browser will not play sound until the person has interacted with the page, and a reload resets that. A refused ping is dropped (a late ping is worse than none); a refused *ring* is remembered and started on the next click or keypress.
- **Bursts.** Each sound that can arrive in a flurry has a minimum gap, so thirty people joining a channel is one tick, not thirty.
- **Android audio mode.** The audio package changes the phone's global audio mode and speakerphone setting whenever a player's context changes, which would break a live voice call. So every player is created and configured once, at app start (`SfxDaemon`), before any call can exist; afterwards playing a sound only starts and stops a player. Do not create players lazily or call `setAudioContext` later.
- **Audio focus.** Android sounds take no audio focus, so a ping never pauses someone's music or interrupts call audio. The ring uses the ringtone usage, so it follows the phone's ringer volume and silent mode.
- **Not verified by ear or on a phone.** The tests measure the audio and the rules; whether it *sounds* good, and how Android routes it on real hardware, has to be heard.
