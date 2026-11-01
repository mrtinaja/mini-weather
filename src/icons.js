const paths = {
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 8a7 7 0 0 1 11.5-3L20 8M4 16l2.9 3A7 7 0 0 0 18.4 16"/>',
 pin:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
 moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
 cloud:'<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 11a3.5 3.5 0 0 1-1 7Z"/>',
 rain:'<path d="M6 14a4.5 4.5 0 1 1 1-8.9A6 6 0 0 1 18.7 8 3 3 0 0 1 19 14M8 17l-1 4m6-4-1 4m6-4-1 4"/>',
 storm:'<path d="M6 14a4.5 4.5 0 1 1 1-8.9A6 6 0 0 1 18.7 8 3 3 0 0 1 19 14m-7-1-3 5h5l-3 5"/>',
 snow:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M3.5 10l4-1-1-4m11 14-1-4 4-1M6.5 19l1-4-4-1m17-4-4-1 1-4"/>',
 fog:'<path d="M5 11a4 4 0 1 1 3-7 5 5 0 0 1 9 3 3 3 0 0 1 2 4M3 15h18M5 19h14"/>',
 wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3"/>',
 drop:'<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>',
 gauge:'<path d="M4 19a10 10 0 1 1 16 0Z"/><path d="m12 13 5-5M6 12h1m10 0h1M12 5v1"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 sunrise:'<path d="M3 18h18M2 22h20M7 14a5 5 0 0 1 10 0M12 2v6m-3-3 3-3 3 3M3 8l2 2m14 0 2-2"/>',
 sunset:'<path d="M3 18h18M2 22h20M7 14a5 5 0 0 1 10 0M12 2v6m-3-3 3 3 3-3M3 8l2 2m14 0 2-2"/>',
 satellite:'<path d="m8 8 8 8m-8-8 4-4 8 8-4 4-8-8Zm-5 3 4-4 4 4-4 4Zm10 10 4-4 4 4-4 4ZM2 17a5 5 0 0 1 5 5m-5-9a9 9 0 0 1 9 9"/>',
 expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 chart:'<path d="M3 3v18h18M6 15l4-5 4 2 6-7"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 external:'<path d="M14 3h7v7m0-7L10 14m0-11H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
 alert:'<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
 thermometer:'<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Zm3-7v11"/>'
};
export function icon(name, cls='') {return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.cloud}</svg>`;}
export function weatherArt(kind, night=false) {
 const cloud=kind!=='sun'&&kind!=='moon';
 return `<svg class="weather-art" viewBox="0 0 200 150" aria-hidden="true"><defs>
 <linearGradient id="silver" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#f2f7f5"/><stop offset=".45" stop-color="#b7c7c0"/><stop offset="1" stop-color="#4f6b60"/></linearGradient>
 <radialGradient id="emerald" cx=".35" cy=".25"><stop stop-color="#c4ffe0"/><stop offset=".5" stop-color="#77c99c"/><stop offset="1" stop-color="#246d4e"/></radialGradient>
 <filter id="depth" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="3" dy="9" stdDeviation="6" flood-color="#000" flood-opacity=".65"/></filter></defs>
 <ellipse cx="102" cy="130" rx="58" ry="10" fill="#000" opacity=".25"/>
 ${!night&&!cloud?'<path d="M100 5v7m0 108v7M39 66h7m108 0h7M57 23l5 5m76 76 5 5M57 109l5-5m76-76 5-5" stroke="#8fcca7" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>':''}
 ${night?'<path d="M134 19a35 35 0 1 0 37 43 29 29 0 0 1-37-43Z" fill="url(#silver)" filter="url(#depth)"/>':`<g filter="url(#depth)"><circle cx="${cloud?132:100}" cy="${cloud?53:66}" r="${cloud?32:43}" fill="url(#emerald)"/><circle cx="${cloud?132:100}" cy="${cloud?53:66}" r="${cloud?43:55}" fill="none" stroke="#7ed6a7" stroke-width="1" opacity=".15"/></g>`}
 ${cloud?'<path d="M55 112a28 28 0 1 1 4-55 39 39 0 0 1 76 7 24 24 0 0 1 3 48Z" fill="url(#silver)" stroke="#e7f7ee55" stroke-width="1" filter="url(#depth)"/>':''}
 ${['rain','storm','snow'].includes(kind)?'<path d="m68 122-3 7m30-7-3 7m30-7-3 7" stroke="#8ee6b5" stroke-width="4" stroke-linecap="round"/>':''}
 ${kind==='storm'?'<path d="m106 85-13 22h13l-10 21 30-30h-16l10-13Z" fill="#b7efd0" filter="url(#depth)"/>':''}
 ${kind==='fog'?'<path d="M50 122h95m-80 9h60" stroke="#a3bcb0" stroke-width="3" stroke-linecap="round"/>':''}</svg>`;
}
