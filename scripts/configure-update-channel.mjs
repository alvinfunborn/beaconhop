import {mkdirSync,writeFileSync} from 'node:fs';
const repo=process.env.RELEASE_REPOSITORY;
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Set RELEASE_REPOSITORY to owner/repo');
mkdirSync('logs',{recursive:true});
writeFileSync('logs/updater-channel.json',JSON.stringify({plugins:{updater:{endpoints:[`https://github.com/${repo}/releases/latest/download/latest.json`]}}}));
