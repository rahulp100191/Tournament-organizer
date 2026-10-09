import {TwaManifest,TwaGenerator,ConsoleLog} from '@bubblewrap/core';
import {mkdir,writeFile} from 'node:fs/promises';
const host=process.env.RALLY_ANDROID_HOST||'rally-tournaments-test.vercel.app';
const manifest=new TwaManifest({packageId:'app.rally.tournaments.test',host,name:'Rally Tournaments Test',launcherName:'Rally Test',display:'standalone',themeColor:'#143c2d',navigationColor:'#143c2d',backgroundColor:'#f5f6f1',enableNotifications:false,startUrl:'/',iconUrl:`https://${host}/icon-512.png`,maskableIconUrl:`https://${host}/icon-maskable.png`,splashScreenFadeOutDuration:300,signingKey:{path:'rally-test.keystore',alias:'rally-test'},appVersionCode:1,appVersion:'0.1.0',fallbackType:'customtabs',enableSiteSettingsShortcut:true,minSdkVersion:24,orientation:'default',fingerprints:[]});
await mkdir('android',{recursive:true});
await new TwaGenerator().createTwaProject('android',manifest,new ConsoleLog('Rally'));
await writeFile('android/twa-manifest.json',JSON.stringify(manifest.toJson(),null,2));
console.log('Generated Android TWA project. The signing key stays local and is never committed.');
