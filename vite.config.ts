import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const version=JSON.parse(readFileSync(new URL('./package.json', import.meta.url),'utf8')).version;
export default defineConfig({plugins:[react()],define:{__APP_VERSION__:JSON.stringify(version)},clearScreen:false,
server:{host:'127.0.0.1',port:1437,strictPort:true},envPrefix:['VITE_','TAURI_'],
build:{target:['es2021','safari14'],sourcemap:!!process.env.TAURI_DEBUG}});
