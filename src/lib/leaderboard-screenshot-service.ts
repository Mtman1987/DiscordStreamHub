import puppeteer from 'puppeteer';
import { PointsService } from './points-service';

export class LeaderboardScreenshotService {
  private static instance: LeaderboardScreenshotService;
  
  static getInstance(): LeaderboardScreenshotService {
    if (!LeaderboardScreenshotService.instance) {
      LeaderboardScreenshotService.instance = new LeaderboardScreenshotService();
    }
    return LeaderboardScreenshotService.instance;
  }

  async generateLeaderboardImage(): Promise<Buffer> {
    const pointsService = PointsService.getInstance();
    const leaderboard = await pointsService.getLeaderboard(10);
    
    const html = this.generateLeaderboardHTML(leaderboard);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 600 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });
      
      return screenshot as Buffer;
    } finally {
      await browser.close();
    }
  }

  private generateLeaderboardHTML(leaderboard: any[]): string {
    const rows = leaderboard.map((user, index) => `
      <tr class="${index < 3 ? 'top-three' : ''}">
        <td class="rank">${this.getRankEmoji(index + 1)} ${index + 1}</td>
        <td class="username">${user.displayName || user.username}</td>
        <td class="points">${user.points.toLocaleString()}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            color: white;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.8);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .title {
            font-size: 2.5em;
            font-weight: bold;
            margin: 0;
            background: linear-gradient(45deg, #FFD700, #FFA500);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
          }
          .subtitle {
            font-size: 1.2em;
            margin: 10px 0 0 0;
            opacity: 0.8;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }
          th {
            background: rgba(255, 255, 255, 0.1);
            font-weight: bold;
            font-size: 1.1em;
          }
          .top-three {
            background: rgba(255, 215, 0, 0.1);
          }
          .rank {
            font-weight: bold;
            font-size: 1.2em;
            width: 80px;
          }
          .username {
            font-size: 1.1em;
          }
          .points {
            font-weight: bold;
            color: #FFD700;
            text-align: right;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            opacity: 0.6;
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">🚀 Space Mountain Leaderboard</h1>
            <p class="subtitle">Top Captains by Points</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Captain</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <div class="footer">
            Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getRankEmoji(rank: number): string {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '🏅';
    }
  }
}