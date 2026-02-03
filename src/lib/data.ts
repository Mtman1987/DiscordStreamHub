// Mock data for UI components

export const events = [
  { id: '1', title: 'Community Game Night', date: new Date('2024-07-20T19:00:00'), type: 'event' },
  { id: '2', title: 'Dev Team Sync', date: new Date('2024-07-22T10:00:00'), type: 'meeting' },
  { id: '3', title: 'QOTD: Favorite Retro Game?', date: new Date('2024-07-23T12:00:00'), type: 'qotd' },
];

export const recentShoutouts = [
  { 
    id: 'shout1', 
    streamerName: 'PixelPioneer', 
    groupType: 'VIP', 
    message: 'The legendary commander, PixelPioneer, has just warped into the sector! Their instruments are calibrated for peak performance.', 
    timestamp: new Date(Date.now() - 3600000) // 1 hour ago
  },
  { 
    id: 'shout2', 
    streamerName: 'GalaxyGlider', 
    groupType: 'Community', 
    message: 'Captain GalaxyGlider is broadcasting live from the outer quadrant! They are currently exploring the cosmos of Starfield.', 
    timestamp: new Date(Date.now() - 7200000) // 2 hours ago
  },
  { 
    id: 'shout3', 
    streamerName: 'RaidRunner', 
    groupType: 'Raid Train', 
    message: 'CHOO CHOO! The raid train is leaving the station! Next stop: RaidRunner\'s channel.', 
    timestamp: new Date(Date.now() - 10800000) // 3 hours ago
  },
];
