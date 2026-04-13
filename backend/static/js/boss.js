var _bossTypeIndex = null;
var _bossPhase = 1;

// ── Randomly pick a boss type once per battle ───────────────
function getBossType() {
  if (_bossTypeIndex === null) {
    _bossTypeIndex = Math.floor(Math.random() * 5); // 5 boss types
  }
  return _bossTypeIndex;
}

// ══════════════════════════════════════════════════════════════
// BOSS DRAW FUNCTIONS
// Each takes (canvas, phase2:bool)
// Uses same px() helper pattern as drawWarrior
// Canvas size is already set before calling
// ══════════════════════════════════════════════════════════════

// ── BOSS 0: ANCIENT DRAGON — FF6/Bahamut style ───────────────────────
// 32-col × 40-row grid. Full winged dragon, frontal display.
function drawDragonBoss(canvas, phase2) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  var P = Math.floor(W / 32);
  function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x*P,y*P,(w||1)*P,(h||1)*P);}

  var B1=phase2?'#5C0000':'#0D4016', B2=phase2?'#8C1010':'#186A24', B3=phase2?'#C02820':'#28922E';
  var BL=phase2?'#FF6644':'#50BB60', SP=phase2?'#300000':'#062A0C';
  var W1=phase2?'#400000':'#082010', W2=phase2?'#880000':'#145A1A', W3=phase2?'#CC2200':'#28882A';
  var EY=phase2?'#FFFF00':'#FF3300', CL='#CCDDE8', FO='#FF6600', FY='#FFDD00';

  // Ground shadow
  ctx.fillStyle='rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(W*.5,H*.97,W*.4,H*.018,0,0,Math.PI*2); ctx.fill();

  // WINGS — left (cols 0-11)
  px(0,5,4,2,W3); px(1,7,3,4,W2); px(2,11,3,5,W1);
  px(2,6,8,11,W2); px(3,5,5,3,W3);
  for(var i=0;i<3;i++){ px(1+i*2,5,1,11-i*2,phase2?'#771100':'#1E6828'); }

  // WINGS — right (cols 21-31)
  px(28,5,4,2,W3); px(29,7,3,4,W2); px(28,11,3,5,W1);
  px(22,6,8,11,W2); px(24,5,5,3,W3);
  for(var i=0;i<3;i++){ px(30-i*2,5,1,11-i*2,phase2?'#771100':'#1E6828'); }

  // TAIL (lower left)
  px(0,28,5,2,B2); px(1,26,4,3,B1); px(0,31,3,2,SP);

  // BODY TORSO (cols 8-24, rows 14-28)
  px(8,15,16,3,B1); px(8,18,16,7,B2); px(9,19,14,5,B3); px(10,21,12,3,BL); px(8,25,16,4,B1);
  // Scale texture
  for(var i=0;i<5;i++){ px(10+i*3,20,2,4,phase2?'#6A0808':'#186428'); }
  // Belly plates
  for(var i=0;i<4;i++){ px(11+i*3,21,2,2,phase2?'#BB3300':'#3AAA55'); }

  // SPINES on back
  for(var i=0;i<7;i++){
    var sx=10+i*2; var h=i%2===0?4:3;
    px(sx,14-h,1,h,SP); px(sx,14-h,1,1,B3);
  }

  // NECK (cols 17-23, rows 6-16)
  px(17,8,6,8,B2); px(18,7,5,8,B1); px(19,6,4,7,B2);
  px(18,5,1,4,SP); px(20,4,1,5,SP); px(22,5,1,4,SP);

  // HEAD (cols 19-31, rows 0-8)
  px(20,1,12,8,B1); px(21,2,10,6,B2); px(22,3,8,4,B3);
  px(26,3,6,2,B2); px(26,5,6,3,B1); px(28,4,4,1,B3); // snout
  px(26,5,6,1,SP); // jaw line
  px(29,4,1,1,SP); px(31,4,1,1,SP); // nostrils
  // Teeth
  for(var i=0;i<3;i++){ px(26+i*2,5,1,2,CL); }
  // Brow / horns
  px(21,1,8,2,SP); px(21,0,1,4,SP); px(22,0,1,3,B3); px(24,0,1,5,SP); px(25,0,1,4,B3);

  // EYE — large glowing
  if(phase2){ctx.shadowColor='#FFFF00';ctx.shadowBlur=20;}
  ctx.fillStyle=EY; ctx.beginPath(); ctx.ellipse(24.5*P,3.5*P,2.2*P,1.6*P,0,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.ellipse(24.5*P,3.5*P,1*P,1*P,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#FFF'; ctx.fillRect(25*P,3*P,P,P);

  // FIRE BREATH (shooting left)
  if(phase2){ctx.shadowColor='#FF5500';ctx.shadowBlur=18;}
  px(16,4,3,1,FY); px(12,3,5,2,FO); px(7,2,6,3,'#FF4400'); px(2,1,6,4,'#CC2200'); px(0,0,3,4,'#AA1100');
  px(13,4,3,1,FY); px(8,3,4,1,FY); px(4,2,4,1,FO);
  ctx.shadowBlur=0;

  // FRONT LEGS
  px(8,28,5,5,B2); px(8,33,5,2,B1); px(7,35,7,1,SP);
  px(7,35,2,2,CL); px(9,35,2,2,CL); px(12,35,2,2,CL);
  px(18,28,5,5,B2); px(18,33,5,2,B1); px(17,35,7,1,SP);
  px(17,35,2,2,CL); px(19,35,2,2,CL); px(22,35,2,2,CL);

  // Phase 2 lava cracks
  if(phase2){
    ctx.strokeStyle='#FF8800';ctx.lineWidth=1.5;ctx.shadowColor='#FF4400';ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(12*P,18*P);ctx.lineTo(14*P,24*P);ctx.lineTo(13*P,28*P);ctx.stroke();
    ctx.beginPath();ctx.moveTo(19*P,19*P);ctx.lineTo(17*P,24*P);ctx.stroke();
    ctx.shadowBlur=0;
  }
}

// ── BOSS 1: IRON GOLEM — FF Adamantoise / Demon Wall style ───────────
function drawGolemBoss(canvas, phase2) {
  var ctx=canvas.getContext('2d'); var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); var P=Math.floor(W/32);
  function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x*P,y*P,(w||1)*P,(h||1)*P);}

  var I1='#141424',I2='#242448',I3='#3A4A78',I4='#5A6A9A',I5='#8899CC';
  var GL=phase2?'#FF2200':'#FF9900', RV='#7788BB';

  ctx.fillStyle='rgba(0,0,0,0.42)';
  ctx.beginPath();ctx.ellipse(W*.5,H*.97,W*.44,H*.018,0,0,Math.PI*2);ctx.fill();

  // BOOTS
  px(2,34,10,5,I1);px(20,34,10,5,I1);px(2,33,9,3,I2);px(20,33,9,3,I2);
  px(2,34,8,1,I4);px(20,34,8,1,I4);px(0,36,3,2,I2);px(29,36,3,2,I2);

  // LEGS with kneecaps
  px(4,22,8,13,I2);px(20,22,8,13,I2);
  px(5,21,6,2,I3);px(21,21,6,2,I3);
  px(4,21,1,14,I1);px(27,21,1,14,I1);
  px(5,22,6,1,I4);px(21,22,6,1,I4);
  // Knee joint circles
  ctx.fillStyle=I3;
  ctx.beginPath();ctx.arc(8*P,23*P,1.5*P,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(24*P,23*P,1.5*P,0,Math.PI*2);ctx.fill();

  // TORSO with panel lines
  px(3,7,26,15,I1);px(4,8,24,14,I2);px(5,9,22,12,I1);
  px(4,8,24,1,I3);px(4,8,1,14,I3);
  px(4,13,24,1,I1);px(4,18,24,1,I1);

  // MASSIVE SPIKED PAULDRONS
  px(0,5,6,12,I1);px(26,5,6,12,I1);px(0,5,5,10,I2);px(27,5,5,10,I2);
  px(0,5,4,1,I4);px(28,5,4,1,I4);
  // Spikes upward
  px(0,1,2,6,I2);px(30,1,2,6,I2);px(2,0,2,7,I1);px(28,0,2,7,I1);
  px(1,0,1,2,I4);px(30,0,1,2,I4);
  // Extra shoulder spikes
  px(4,0,2,5,I2);px(26,0,2,5,I2);

  // ARMS — long with elbow joint
  px(0,14,4,16,I2);px(28,14,4,16,I2);
  px(0,14,1,16,I1);px(31,14,1,16,I1);
  px(1,14,2,1,I4);px(29,14,2,1,I4);
  px(0,20,5,3,I1);px(27,20,5,3,I1);px(1,20,3,2,I4);px(28,20,3,2,I4);
  // FISTS with knuckle spikes
  px(0,28,5,5,I1);px(27,28,5,5,I1);px(0,28,4,1,I4);px(28,28,4,1,I4);
  px(0,27,1,2,I3);px(2,27,1,2,I3);px(4,27,1,2,I3);
  px(27,27,1,2,I3);px(29,27,1,2,I3);px(31,27,1,2,I3);

  // CHEST CORE — pulsing rune
  if(phase2){ctx.shadowColor=GL;ctx.shadowBlur=30;}
  ctx.beginPath();ctx.arc(W*.5,15*P,4.5*P,0,Math.PI*2);ctx.fillStyle=I1;ctx.fill();
  ctx.beginPath();ctx.arc(W*.5,15*P,3.5*P,0,Math.PI*2);ctx.fillStyle=GL;ctx.fill();
  ctx.beginPath();ctx.arc(W*.5,15*P,2.2*P,0,Math.PI*2);ctx.fillStyle='#FFFFFF';ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle=I1;ctx.font='bold '+(3*P)+'px serif';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✦',W*.5,15.3*P);

  // HEAD — cube with forehead detail
  px(7,1,18,7,I1);px(8,2,16,6,I2);px(8,2,15,1,I4);px(8,2,1,5,I4);px(8,4,16,1,I1);
  // Decorative top plates
  px(10,0,4,3,I3);px(18,0,4,3,I3);px(11,0,2,2,I4);px(19,0,2,2,I4);

  // GLOWING VISOR
  if(phase2){ctx.shadowColor=GL;ctx.shadowBlur=22;}
  ctx.fillStyle=GL; ctx.fillRect(9*P,3*P,14*P,2.5*P);
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.fillRect(9*P,3*P,14*P,0.8*P);
  ctx.fillStyle=I2; ctx.fillRect(15*P,3*P,2*P,2.5*P); // divider

  // Rivets
  ctx.fillStyle=RV;
  [[4,9],[27,9],[4,20],[27,20],[16,9],[16,20],[4,14],[27,14]].forEach(function(r){
    ctx.beginPath();ctx.arc(r[0]*P,r[1]*P,0.9*P,0,Math.PI*2);ctx.fill();
  });

  // Phase 2 cracks
  if(phase2){
    ctx.strokeStyle='#FF4400';ctx.lineWidth=2;ctx.shadowColor='#FF4400';ctx.shadowBlur=12;
    ctx.beginPath();ctx.moveTo(10*P,10*P);ctx.lineTo(13*P,17*P);ctx.lineTo(12*P,22*P);ctx.stroke();
    ctx.beginPath();ctx.moveTo(22*P,11*P);ctx.lineTo(19*P,16*P);ctx.stroke();
    ctx.shadowBlur=0;
  }
}

// ── BOSS 2: VOID SPECTER — FF Kefka / Ultima Weapon style ────────────
function drawSpecterBoss(canvas, phase2) {
  var ctx=canvas.getContext('2d'); var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); var P=Math.floor(W/32);
  function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x*P,y*P,(w||1)*P,(h||1)*P);}

  var V1='#050010',V2='#0E0022',V3='#1C0044',V4='#2E0066';
  var VP=phase2?'#FF00CC':'#9944FF', VH=phase2?'#FFAAFF':'#CC88FF';

  ctx.fillStyle='rgba(80,0,200,0.12)';
  ctx.beginPath();ctx.ellipse(W*.5,H*.93,W*.26,H*.015,0,0,Math.PI*2);ctx.fill();

  // ROBE — dramatically widening from chest to floor, 10 tiers
  px(0,34,32,5,V2); px(1,32,30,4,V1); px(2,30,28,4,V2); px(3,28,26,4,V1);
  px(5,26,22,4,V2); px(6,24,20,4,V1); px(7,22,18,4,V2); px(8,20,16,4,V3);
  px(9,18,14,4,V2); px(10,16,12,4,V3); px(11,14,10,4,V4); px(12,12,8,4,V3);
  px(12,10,8,4,V2); px(12,8,8,4,V1);

  // Robe fold shading — vertical lines
  for(var i=0;i<6;i++){
    var fx=5+i*4;
    px(fx,18,1,18,V3); px(fx+1,20,1,14,V4);
  }
  // Hem highlight
  px(0,38,32,1,V4); px(1,37,30,1,V3);

  // SLEEVES
  px(1,14,8,6,V2); px(23,14,8,6,V2);
  px(2,14,5,1,V4); px(24,14,5,1,V4);

  // CLAW HANDS
  if(phase2){ctx.shadowColor=VP;ctx.shadowBlur=16;}
  ctx.fillStyle=VP;
  [[0,19],[2,21],[0,22],[3,20]].forEach(function(p){ctx.beginPath();ctx.arc(p[0]*P,p[1]*P,1.3*P,0,Math.PI*2);ctx.fill();});
  [[31,19],[29,21],[31,22],[28,20]].forEach(function(p){ctx.beginPath();ctx.arc(p[0]*P,p[1]*P,1.3*P,0,Math.PI*2);ctx.fill();});
  ctx.shadowBlur=0;

  // HOOD — 2 pointed horns
  px(10,2,12,8,V1);px(11,3,10,7,V2);px(12,4,8,6,V3);px(13,5,6,5,V2);
  // Horn left
  px(9,0,3,4,V1);px(10,0,2,3,V2);px(10,-1,1,2,V3);
  // Horn right
  px(20,0,3,4,V1);px(20,0,2,3,V2);px(21,-1,1,2,V3);
  px(10,8,12,2,V1); // cowl shadow

  // FACE — shadowed
  px(12,5,8,6,V2);px(13,6,6,4,V1);

  // EYES — large FF-style orbs
  if(phase2){ctx.shadowColor=VP;ctx.shadowBlur=28;}
  ctx.fillStyle=VP;
  ctx.beginPath();ctx.arc(14.5*P,7.5*P,2.2*P,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(17.5*P,7.5*P,2.2*P,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle='#FFF';
  ctx.beginPath();ctx.arc(14.5*P,7.5*P,1*P,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(17.5*P,7.5*P,1*P,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';
  ctx.beginPath();ctx.arc(14.5*P,7.8*P,.55*P,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(17.5*P,7.8*P,.55*P,0,Math.PI*2);ctx.fill();

  // CHEST MAGIC ORB
  if(phase2){ctx.shadowColor=VP;ctx.shadowBlur=35;}
  ctx.beginPath();ctx.arc(W*.5,15*P,3.2*P,0,Math.PI*2);ctx.fillStyle=V1;ctx.fill();
  ctx.beginPath();ctx.arc(W*.5,15*P,2.8*P,0,Math.PI*2);ctx.fillStyle=VP;ctx.fill();
  ctx.beginPath();ctx.arc(W*.5,15*P,1.8*P,0,Math.PI*2);ctx.fillStyle=VH;ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle='#FFF';ctx.beginPath();ctx.arc(W*.5-.9*P,14*P,.85*P,0,Math.PI*2);ctx.fill();

  // Runes at hem
  if(phase2){ctx.shadowColor=VP;ctx.shadowBlur=8;}
  ctx.fillStyle=VH;ctx.font=(2.2*P)+'px serif';ctx.textAlign='center';
  ['ᚠ','ᚱ','ᛗ','ᛟ'].forEach(function(r,i){ctx.fillText(r,(4+i*8)*P,38.5*P);});
  ctx.shadowBlur=0;
}

// ── BOSS 3: STORM TITAN — FF Gilgamesh / Atma Weapon style ───────────
function drawTitanBoss(canvas, phase2) {
  var ctx=canvas.getContext('2d'); var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); var P=Math.floor(W/32);
  function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x*P,y*P,(w||1)*P,(h||1)*P);}

  var A1='#080E20',A2='#12203C',A3='#1E3862',A4='#2E5088',A5='#6880BB';
  var LT=phase2?'#FF9900':'#FFEE44', EL=phase2?'#FF6600':'#88CCFF', CL='#DDEEFF';

  ctx.fillStyle='rgba(0,0,0,0.4)';
  ctx.beginPath();ctx.ellipse(W*.5,H*.97,W*.42,H*.018,0,0,Math.PI*2);ctx.fill();

  // ARMORED SABATONS
  px(6,34,8,5,A1);px(18,34,8,5,A1);px(6,33,7,3,A2);px(19,33,7,3,A2);
  px(6,34,6,1,A4);px(20,34,6,1,A4);px(4,36,3,2,A2);px(25,36,3,2,A2);

  // GREAVES with kneecap
  px(7,23,7,12,A2);px(18,23,7,12,A2);
  px(8,22,5,3,A3);px(19,22,5,3,A3);
  px(7,23,1,12,A1);px(24,23,1,12,A1);
  px(8,23,5,1,A4);px(20,23,5,1,A4);
  px(7,26,2,2,A3);px(23,26,2,2,A3);

  // TORSO — layered plate
  px(5,8,22,15,A1);px(6,9,20,14,A2);px(7,10,18,13,A1);
  px(7,9,18,1,A4);px(7,9,1,14,A4);
  px(7,16,18,1,A2);
  for(var i=0;i<3;i++){ px(8,17+i*2,16,1,A3); }

  // MASSIVE SPIKED PAULDRONS
  px(0,6,8,12,A1);px(24,6,8,12,A1);px(0,6,7,10,A2);px(25,6,7,10,A2);
  px(0,7,6,1,A4);px(26,7,6,1,A4);
  // Spike cluster left
  px(0,1,3,7,A2);px(1,0,2,5,A3);px(3,0,3,8,A1);px(2,-1,2,3,A4);
  px(5,0,2,6,A2);px(4,-1,2,4,A3);
  // Spike cluster right
  px(26,1,3,7,A2);px(27,0,2,5,A3);px(28,0,3,8,A1);px(28,-1,2,3,A4);
  px(25,0,2,6,A2);px(26,-1,2,4,A3);

  // ARMS — armored bracers
  px(0,16,5,14,A2);px(27,16,5,14,A2);
  px(0,16,1,14,A1);px(31,16,1,14,A1);
  px(1,16,3,1,A4);px(28,16,3,1,A4);
  // GAUNTLETS with knuckle spikes
  px(0,28,6,5,A1);px(26,28,6,5,A1);
  px(0,28,5,1,A4);px(27,28,5,1,A4);
  px(0,27,1,2,A3);px(2,27,1,2,A3);px(4,27,1,2,A3);
  px(27,27,1,2,A3);px(29,27,1,2,A3);px(31,27,1,2,A3);

  // SWORD — right side, pointing up (two-hander FF style)
  px(26,0,2,30,CL);px(27,0,1,28,'#99AADD');px(26,0,1,2,'#FFFFFF');
  px(23,20,8,2,A4);px(23,20,8,1,A5); // crossguard
  px(24,22,4,6,'#2A1400');px(25,22,2,1,'#7A4010'); // grip

  // Blade glow in phase 2
  if(phase2){ctx.strokeStyle=LT;ctx.lineWidth=1.5;ctx.shadowColor=LT;ctx.shadowBlur=18;
    ctx.beginPath();ctx.moveTo(26.5*P,0);ctx.lineTo(26.5*P,28*P);ctx.stroke();ctx.shadowBlur=0;}

  // CHEST LIGHTNING BOLT
  if(phase2){ctx.shadowColor=LT;ctx.shadowBlur=28;}
  ctx.fillStyle=LT;
  ctx.beginPath();
  ctx.moveTo(16*P,10*P);ctx.lineTo(12.5*P,16*P);ctx.lineTo(15.5*P,16*P);
  ctx.lineTo(11*P,24*P);ctx.lineTo(20*P,15*P);ctx.lineTo(16.5*P,15*P);
  ctx.lineTo(20*P,10*P);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;

  // HELMET with plume
  px(9,2,14,7,A1);px(10,3,12,6,A2);px(10,3,11,1,A4);px(10,3,1,5,A4);
  // Crest
  px(13,0,6,4,A3);px(14,-1,4,3,A2);px(15,-2,2,2,A4);
  // Plume feathers
  for(var i=0;i<5;i++){px(13+i,-2-i,1,i+3,phase2?'#FF4400':'#AA0000');}

  // VISOR
  if(phase2){ctx.shadowColor=EL;ctx.shadowBlur=20;}
  ctx.fillStyle=EL;ctx.fillRect(11*P,5*P,10*P,2.5*P);
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,0.25)';ctx.fillRect(11*P,5*P,10*P,.8*P);

  // Phase 2 lightning arcs
  if(phase2){
    ctx.strokeStyle=LT;ctx.lineWidth=2;ctx.shadowColor=LT;ctx.shadowBlur=14;
    [[3,9],[6,14],[3,19]].forEach(function(p){
      ctx.beginPath();ctx.moveTo(p[0]*P,(p[1]-3)*P);ctx.lineTo((p[0]-1)*P,p[1]*P);
      ctx.lineTo((p[0]+1)*P,(p[1]+1)*P);ctx.lineTo((p[0]-1)*P,(p[1]+3)*P);ctx.stroke();
    });
    ctx.shadowBlur=0;
  }
}

// ── BOSS 4: LEVIATHAN — FF sea serpent / Leviathan summon style ──────
function drawLeviathanBoss(canvas, phase2) {
  var ctx=canvas.getContext('2d'); var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); var P=Math.floor(W/32);
  function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x*P,y*P,(w||1)*P,(h||1)*P);}

  var C1='#001018',C2='#001E38',C3='#003060',C4='#004A8A';
  var SC=phase2?'#FF4400':'#0088CC', SL=phase2?'#FF8844':'#44BBEE', EY=phase2?'#FF4400':'#00CCFF';

  ctx.fillStyle='rgba(0,0,0,0.3)';
  ctx.beginPath();ctx.ellipse(W*.5,H*.95,W*.36,H*.015,0,0,Math.PI*2);ctx.fill();

  // COILED BODY — 3 tiers
  px(0,30,32,9,C1);px(1,31,30,8,C2);px(2,32,28,7,C3);px(3,33,26,6,C4);
  px(2,22,28,10,C1);px(3,23,26,9,C2);px(4,24,24,8,C3);px(5,25,22,7,C4);
  px(5,15,22,9,C1);px(6,16,20,8,C2);px(7,17,18,7,C3);

  // SCALE PATTERN — elliptical, 5 rows
  ctx.fillStyle=SC;
  for(var row=0;row<5;row++){
    for(var col=0;col<8;col++){
      var sx=3+col*4+(row%2)*2; var sy=25+row*4;
      if(sx<30&&sy<38){ctx.beginPath();ctx.ellipse(sx*P,sy*P,1.6*P,1.2*P,0,0,Math.PI*2);ctx.fill();}
    }
  }
  // Scale shine
  ctx.fillStyle=SL;
  for(var row=0;row<4;row++){
    for(var col=0;col<6;col++){
      var sx=4+col*4+(row%2)*2; var sy=26+row*4;
      if(sx<30&&sy<36){ctx.beginPath();ctx.arc(sx*P,sy*P,.65*P,0,Math.PI*2);ctx.fill();}
    }
  }

  // NECK sweeping up-right
  px(18,9,8,7,C2);px(19,8,7,7,C1);px(20,7,6,6,C2);px(21,6,5,5,C3);

  // HEAD — elongated
  px(20,1,12,7,C1);px(21,2,10,6,C2);px(22,3,8,5,C3);px(23,4,6,4,C4);
  // Snout
  px(28,2,4,2,C2);px(28,4,4,3,C1);px(29,3,3,1,C4);

  // HEAD FINS — 3 dramatic
  if(phase2){ctx.shadowColor=SC;ctx.shadowBlur=14;}
  ctx.fillStyle=SC;
  ctx.beginPath();ctx.moveTo(22*P,2*P);ctx.lineTo(19*P,-3*P);ctx.lineTo(25*P,1*P);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(25*P,2*P);ctx.lineTo(24*P,-6*P);ctx.lineTo(29*P,1*P);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(20*P,4*P);ctx.lineTo(17*P,-1*P);ctx.lineTo(22*P,3*P);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;

  // EYE — large
  if(phase2){ctx.shadowColor=EY;ctx.shadowBlur=22;}
  ctx.fillStyle=EY;ctx.beginPath();ctx.arc(24.5*P,4.5*P,2.4*P,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle='#FFF';ctx.beginPath();ctx.arc(24.5*P,4.5*P,1.2*P,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(24.5*P,4.8*P,.75*P,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#FFF';ctx.fillRect(25*P,4*P,.9*P,.9*P);

  // FANGS
  [28,30,32].forEach(function(fx){if(fx<33){px(fx-1,4,1,3,'#EEEEFF');px(fx-1,7,1,2,'#CCCCDD');}});

  // WATER TENTACLES
  for(var i=0;i<5;i++){
    if(phase2){ctx.shadowColor=SC;ctx.shadowBlur=10;}
    ctx.strokeStyle=phase2?'#FF5500':C4;ctx.lineWidth=P*1.8;
    var tx=P*(2+i*6);
    ctx.beginPath();ctx.moveTo(tx,H*.9);ctx.quadraticCurveTo(tx-3*P,H*.95,tx-4*P,H);ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Water spray
  ctx.fillStyle=phase2?'rgba(255,80,0,0.35)':'rgba(0,140,210,0.28)';
  for(var i=0;i<8;i++){
    var wx=(3+i*4)*P,wy=(32+Math.floor(Math.random()*3))*P;
    ctx.beginPath();ctx.ellipse(wx,wy,P,P*.5,.3,0,Math.PI*2);ctx.fill();
  }
}


// ══════════════════════════════════════════════════════════════
// BOSS CANVAS FACTORY
// Creates a canvas, sizes it, draws the boss, returns the canvas.
// phase2=false → 208×240 (P≈8), phase2=true → 286×330 (P≈11)
// ══════════════════════════════════════════════════════════════
var BOSS_DRAW_FUNCS = [
  drawDragonBoss,
  drawGolemBoss,
  drawSpecterBoss,
  drawTitanBoss,
  drawLeviathanBoss,
];

function createBossCanvas(phase2) {
  var canvas = document.createElement('canvas');
  // Phase1: 26 cols * 8px = 208 canvas → 1.5× CSS = 312×360px
  // Phase2: 26 cols * 10px = 260 canvas → 1.5× CSS = 390×450px
  // 450px fits comfortably inside battle-scene at 100% browser zoom on typical screens.
  // (585px at P=13 was taller than the available viewport area, clipping the boss top.)
  var P = phase2 ? 10 : 8;
  var cols = 26, rows = 30;
  canvas.width  = cols * P;
  canvas.height = rows * P;

  // CSS display size: let CSS scale it up but keep pixel art crisp
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  // Phase1: 1.5× scale. Phase2: 1.5× scale (P is already bigger, giving the size jump).
  var cssScale = 1.5;
  var rawW = cols * P * cssScale;
  var rawH = rows * P * cssScale;
  // Dynamically measure the actual battle-bottom height so the clamp is accurate
  // whether or not the question panel is visible. Fall back to 300px if not in DOM.
  var _bb = document.getElementById('battle-bottom');
  var _bbH = _bb ? _bb.getBoundingClientRect().height : 260;
  var _topBar = 42; // fixed px
  var _hpSection = 90; // boss name + hp bar + phase bar + margins
  var maxH = Math.max(180, window.innerHeight - _topBar - _bbH - _hpSection);
  var maxW = window.innerWidth * 0.52;
  if (rawH > maxH || rawW > maxW) {
    var scaleDown = Math.min(maxH / rawH, maxW / rawW);
    rawW = Math.floor(rawW * scaleDown);
    rawH = Math.floor(rawH * scaleDown);
  }
  canvas.style.width  = rawW + 'px';
  canvas.style.height = rawH + 'px';

  canvas.className = 'boss-canvas monster-sprite';
  canvas.id = 'boss-main-canvas';

  var drawFn = BOSS_DRAW_FUNCS[getBossType()];
  drawFn(canvas, phase2);

  return canvas;
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API — called by game.js
// ══════════════════════════════════════════════════════════════

// Called by game.js after injecting monster.sprite into monster-container
function initDragonSprite() {
  var container = document.getElementById('monster-container');
  if (!container) return;
  // Replace whatever placeholder is there with a real drawn canvas
  container.innerHTML = '';
  var canvas = createBossCanvas(false);
  container.appendChild(canvas);
}

// Called by game.js triggerPhase2 (via arena patch)
function redrawBossPhase2() {
  var container = document.getElementById('monster-container');
  if (!container) return;
  container.innerHTML = '';
  var canvas = createBossCanvas(true);
  canvas.classList.add('rage-mode');
  container.appendChild(canvas);
}

// ── Boss attack: shuffles between fireball, sword, fire projectile ────────────
var _bossProjectileIndex = 0;
function animateBossAttack(fromEl, toEl, onComplete) {
  if (!fromEl || !toEl) { if (onComplete) onComplete(); return; }
  var fr = fromEl.getBoundingClientRect();
  var tr = toEl.getBoundingClientRect();

  var type = _bossProjectileIndex % 3; // 0=fireball, 1=sword, 2=fire
  _bossProjectileIndex++;

  var proj = document.createElement('div');

  if (type === 0) {
    // FIREBALL — glowing orange/red orb
    proj.style.cssText = [
      'position:fixed', 'width:26px', 'height:26px', 'border-radius:50%',
      'background:radial-gradient(circle,#ffe066 0%,#ff8800 40%,#cc2200 80%,#660000 100%)',
      'box-shadow:0 0 20px #ff6600,0 0 40px #ff220088,0 0 8px #ffdd00 inset',
      'z-index:9999', 'pointer-events:none',
    ].join(';');
  } else if (type === 1) {
    // SWORD — elongated sharp shape
    proj.style.cssText = [
      'position:fixed', 'width:10px', 'height:38px',
      'background:linear-gradient(180deg,#ffffff 0%,#aaccff 30%,#4488ff 70%,#002288 100%)',
      'box-shadow:0 0 14px #4488ff,0 0 28px #2244cc88',
      'clip-path:polygon(50% 0%,100% 25%,80% 100%,20% 100%,0% 25%)',
      'z-index:9999', 'pointer-events:none',
    ].join(';');
  } else {
    // FIRE — wide flickering flame blob
    proj.style.cssText = [
      'position:fixed', 'width:30px', 'height:24px', 'border-radius:60% 60% 40% 40%',
      'background:radial-gradient(ellipse,#ffee00 0%,#ff6600 45%,#cc1100 100%)',
      'box-shadow:0 0 22px #ff4400,0 0 44px #ff220055,0 -4px 12px #ffcc00',
      'z-index:9999', 'pointer-events:none',
    ].join(';');
  }

  var sx = fr.left + fr.width  * 0.35;
  var sy = fr.top  + fr.height * 0.2;
  var ex = tr.left + tr.width  * 0.5 - 13;
  var ey = tr.top  + tr.height * 0.35 - 13;
  var cx = sx + (ex - sx) * 0.2 - 30;
  var cy = Math.min(sy, ey) - 80;

  proj.style.left = sx + 'px';
  proj.style.top  = sy + 'px';
  document.body.appendChild(proj);

  var t = 0;
  function step() {
    t += 0.010; // slowed down (was 0.024)
    if (t >= 1) {
      proj.remove();
      if (onComplete) onComplete();
      return;
    }
    var mt = 1 - t;
    var x = mt*mt*sx + 2*mt*t*cx + t*t*ex;
    var y = mt*mt*sy + 2*mt*t*cy + t*t*ey;
    proj.style.left = x + 'px';
    proj.style.top  = y + 'px';
    var angle = type === 1 ? (t * 360) : (t * 180);
    proj.style.transform = 'rotate(' + angle + 'deg) scale(' + (1 - t*0.2) + ')';
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Player attack: shoots green projectile toward boss ────────────────────────
function animatePlayerAttack(fromEl, toEl, onComplete) {
  if (!fromEl || !toEl) { if (onComplete) onComplete(); return; }
  var fr = fromEl.getBoundingClientRect();
  var tr = toEl.getBoundingClientRect();

  var proj = document.createElement('div');
  proj.style.cssText = [
    'position:fixed', 'width:22px', 'height:22px', 'border-radius:50%',
    'background:radial-gradient(circle,#ffffff 0%,#88ffaa 35%,#22cc55 70%,#006622 100%)',
    'box-shadow:0 0 18px #44ff88,0 0 36px #22cc5588,0 0 6px #ccffdd inset',
    'z-index:9999', 'pointer-events:none',
  ].join(';');

  var sx = fr.left + fr.width  * 0.75;
  var sy = fr.top  + fr.height * 0.35;
  var ex = tr.left + tr.width  * 0.3 - 11;
  var ey = tr.top  + tr.height * 0.3 - 11;
  // Arc upward then into boss
  var cx = sx + (ex - sx) * 0.6;
  var cy = Math.min(sy, ey) - 90;

  proj.style.left = sx + 'px';
  proj.style.top  = sy + 'px';
  document.body.appendChild(proj);

  var t = 0;
  function step() {
    t += 0.016;
    if (t >= 1) {
      // small burst on impact
      proj.style.transform = 'scale(2.5)';
      proj.style.opacity = '0';
      proj.style.transition = 'transform 0.2s, opacity 0.2s';
      setTimeout(function(){ proj.remove(); }, 220);
      if (onComplete) onComplete();
      return;
    }
    var mt = 1 - t;
    var x = mt*mt*sx + 2*mt*t*cx + t*t*ex;
    var y = mt*mt*sy + 2*mt*t*cy + t*t*ey;
    proj.style.left = x + 'px';
    proj.style.top  = y + 'px';
    proj.style.transform = 'scale(' + (1 + t * 0.3) + ')';
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══════════════════════════════════════════════════════════════
// selectMonster — returns the monster config object for game.js
// Re-clamp the boss canvas after the question panel expands battle-bottom.
// Called by game.js immediately after combat-section becomes visible.
window.reclampBossCanvas = function() {
  var canvas = document.querySelector('#monster-container canvas');
  if (!canvas) return;
  var _bb = document.getElementById('battle-bottom');
  var _bbH = _bb ? _bb.getBoundingClientRect().height : 260;
  var _topBar = 42;
  var _hpSection = 90;
  var maxH = Math.max(180, window.innerHeight - _topBar - _bbH - _hpSection);
  var maxW = window.innerWidth * 0.52;
  // Current CSS-displayed size
  var curW = parseFloat(canvas.style.width)  || canvas.offsetWidth;
  var curH = parseFloat(canvas.style.height) || canvas.offsetHeight;
  if (curH <= maxH && curW <= maxW) return;  // already fits
  var scaleDown = Math.min(maxH / curH, maxW / curW);
  canvas.style.width  = Math.floor(curW * scaleDown) + 'px';
  canvas.style.height = Math.floor(curH * scaleDown) + 'px';
};

// game.js calls: monster.sprite → innerHTML into #monster-container
// then calls initDragonSprite() to actually draw
// ══════════════════════════════════════════════════════════════
function selectMonster(topic) {
  // Reset boss type for this battle
  _bossTypeIndex = Math.floor(Math.random() * BOSS_DRAW_FUNCS.length);

  return {
    name:        'The Knowledge Dragon',
    title:       'Ancient Keeper of Wisdom',
    maxHp:       100,
    phase1Color: '#22AA38',
    phase2Color: '#FF2200',
    glowColor:   '#FF4400',
    // Sprite HTML: just an empty canvas placeholder with correct id.
    // initDragonSprite() will replace this with the real drawn canvas.
    sprite: '<canvas id="boss-main-canvas" class="boss-canvas monster-sprite" width="208" height="240" style="image-rendering:pixelated;display:block;"></canvas>',
    taunts: {
      intro:  'You dare challenge me?! My knowledge spans millennia!',
      hit:    ['A lucky strike!', 'You... know something?!', 'Impossible!', 'Grr... not bad.'],
      miss:   ['HAHAHA! Pathetic!', 'Your knowledge is weak!', 'Study harder, mortal!', 'Disappointing!'],
      phase2: 'ENOUGH! Feel my TRUE power!',
      defeat: 'No... defeated by a mere student... *dissolves into knowledge*',
    },
  };
}

function getRandomTaunt(monster, situation) {
  var pool = {
    intro:  monster.taunts && monster.taunts.intro,
    hit:    monster.taunts && monster.taunts.hit,
    miss:   monster.taunts && monster.taunts.miss,
    phase2: monster.taunts && monster.taunts.phase2,
    defeat: monster.taunts && monster.taunts.defeat,
    phase1: monster.taunts && (monster.taunts.phase1 || monster.taunts.intro),
  }[situation];
  if (!pool) return '...';
  return Array.isArray(pool) ? pool[Math.floor(Math.random() * pool.length)] : pool;
}

// Backward compat
var MONSTERS = {};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MONSTERS, selectMonster, getRandomTaunt, animateBossAttack, redrawBossPhase2 };
}