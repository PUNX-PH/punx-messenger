// Every part of the app that is loaded on demand, defined once.
//
// Defined here and not beside each use so the list that gets warmed up in the
// background (preloadCommon) cannot drift from the list that is actually lazy.
//
// What stays out of the first download, and why:
//   AdminPanel          few people ever open it
//   VoiceChannelRoom    a whole screen, needed only when a voice channel is opened
//   EmojiPicker         opens on a click; it also carries the GIF panel
//   GroupSettingsModal, ChannelAccessModal, CreateGroupModal
//                       dialogs, shown on demand
import { lazyWithPreload, preloadWhenIdle } from './lazy'

export const AdminPanel = lazyWithPreload(() => import('../views/AdminPanel'))
export const VoiceChannelRoom = lazyWithPreload(() => import('../views/VoiceChannelRoom'))
export const EmojiPicker = lazyWithPreload(() => import('../components/EmojiPicker'))
export const GroupSettingsModal = lazyWithPreload(() => import('../components/GroupSettingsModal'))
export const ChannelAccessModal = lazyWithPreload(() => import('../components/ChannelAccessModal'))
export const CreateGroupModal = lazyWithPreload(() => import('../components/CreateGroupModal'))

/**
 * Warms up what nearly everyone ends up using, once the app is up. The admin panel
 * and the settings dialogs are deliberately left out: most people never open
 * them, and downloading them in the background would just spend their data.
 */
export const preloadCommon = () => preloadWhenIdle([EmojiPicker, VoiceChannelRoom])
