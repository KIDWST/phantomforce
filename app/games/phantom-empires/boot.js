import {createBattlefield3D} from './battlefield3d.js?v=2.0.0';
try {window.PhantomEmpires3D=createBattlefield3D();}
catch(error){document.documentElement.dataset.rendererFallback='true';console.warn('3D renderer unavailable; using compatibility battlefield.',error.message);}
const game=document.createElement('script');game.src='game.js?v=2.0.0';document.body.append(game);
