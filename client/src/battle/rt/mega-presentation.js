// Presentation clock only: queued announcements and a burst at the actual transformation event.
export class MegaPresentation {
  constructor() { this.queue = []; this.bursts = []; }
  get current() { return this.queue[0] || null; }
  add(event, image, title) {
    this.queue.push({side:event.s, from:event.from, species:event.species, image, title, age:0});
    this.bursts.push({side:event.s, unit:event.u || 0, slot:event.slot, age:0});
  }
  update(dt) {
    this.bursts = this.bursts.filter(b => (b.age += dt) < 1);
    if (this.current && (this.current.age += dt) >= 2.4) this.queue.shift();
  }
  drawBurst(ctx, x, y, scale, side, unit, slot, reduced) {
    const b = this.bursts.find(b => b.side === side && b.unit === unit && b.slot === slot);
    if (!b) return;
    const p = reduced ? .5 : b.age;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, (1-b.age)*2);
    ctx.strokeStyle = '#ffd6f2';
    ctx.lineWidth = Math.max(2, scale*.1);
    ctx.beginPath(); ctx.ellipse(x, y-scale, scale*(.6+p*1.8), scale*(.9+p*1.8), 0, 0, Math.PI*2); ctx.stroke();
    if (!reduced) for (let i=0;i<8;i++) {
      const a=i*Math.PI/4, inner=scale*(.8+p), outer=inner+scale*.5;
      ctx.beginPath();
      ctx.moveTo(x+Math.cos(a)*inner,y-scale+Math.sin(a)*inner);
      ctx.lineTo(x+Math.cos(a)*outer,y-scale+Math.sin(a)*outer); ctx.stroke();
    }
    ctx.restore();
  }
  draw(ctx, width, height, reduced, title) {
    const n=this.current;
    if (!n) return;
    const h=Math.max(44,Math.min(height*.19,110)), y=height*.06, inset=width*.025;
    const alpha=reduced ? 1 : Math.min(1,n.age/.12,(2.4-n.age)/.2);
    ctx.save(); ctx.globalAlpha*=Math.max(0,alpha);
    ctx.fillStyle='rgba(24,16,32,.95)'; ctx.fillRect(inset,y,width-inset*2,h);
    ctx.strokeStyle=n.side===0?'#90c7ff':'#ffb5cf'; ctx.lineWidth=2; ctx.strokeRect(inset,y,width-inset*2,h);
    const size=h*.85, image=n.image?.ready ? n.image.img : null;
    let tx=inset+h*.2;
    if (image) {
      const w=size*image.width/image.height;
      ctx.drawImage(image,tx+(size-w)/2,y+(h-size)/2,w,size); tx+=size+h*.18;
    }
    ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillStyle='#ffd6f2';
    const fit=(text,initial)=>{
      let fs=initial; ctx.font=`800 ${fs}px system-ui, sans-serif`;
      while(fs>10&&ctx.measureText(text).width>width-inset-tx-h*.15)ctx.font=`800 ${--fs}px system-ui, sans-serif`;
      return text;
    };
    ctx.fillText(fit(title || n.title,Math.max(13,Math.round(h*.32))),tx,y+h*.34);
    ctx.fillStyle='#ffffff';
    ctx.fillText(fit(`${n.from} → ${n.species}`,Math.max(12,Math.round(h*.23))),tx,y+h*.72);
    ctx.restore();
  }
}
