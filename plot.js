(() => {
  'use strict';
  const math={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,
    arcsin:Math.asin,arccos:Math.acos,arctan:Math.atan,ln:Math.log,log10:Math.log10,exp:Math.exp,
    sqrt:Math.sqrt,cbrt:Math.cbrt,abs:Math.abs,sign:Math.sign};
  function compile(raw){
    const source=raw.trim().replace(/^y\s*=\s*/i,'').toLowerCase().replaceAll('π','pi')
      .replaceAll('−','-').replaceAll('×','*').replaceAll('÷','/').replaceAll('²','^2').replaceAll('³','^3');
    if(source.length>360)throw new Error('表达式过长。');
    const tokens=source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z][a-z0-9]*|[()+*/^-]|\S/g)||[];
    let i=0;
    const take=t=>tokens[i]===t?(i++,true):false;
    const need=t=>{if(!take(t))throw new Error('缺少 '+t+'。');};
    const number=t=>/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(t||'');
    const atomStart=t=>t==='('||/^[a-z]/.test(t||'')||number(t);
    function atom(){
      if(take('(')){const fn=sum();need(')');return fn;}
      const t=tokens[i++];
      if(number(t)){const value=Number(t);if(!Number.isFinite(value))throw new Error('数值过大。');return ()=>value;}
      if(t==='x')return x=>x;
      if(t==='pi')return ()=>Math.PI;
      if(t==='e')return ()=>Math.E;
      if(Object.hasOwn(math,t)){need('(');const arg=sum();need(')');return x=>math[t](arg(x));}
      throw new Error(t?'不支持的符号：'+t+'。':'表达式不完整。');
    }
    function unary(){
      if(take('+'))return unary();
      if(take('-')){const v=unary();return x=>-v(x);}
      const a=atom();
      if(!take('^'))return a;
      const b=unary();return x=>Math.pow(a(x),b(x));
    }
    function product(){
      let fn=unary();
      while(i<tokens.length){
        const divide=take('/');
        if(!divide&&!take('*')&&!atomStart(tokens[i]))break;
        const a=fn,b=unary();
        fn=divide?x=>a(x)/b(x):x=>a(x)*b(x);
      }
      return fn;
    }
    function sum(){
      let fn=product();
      while(tokens[i]==='+'||tokens[i]==='-'){
        const op=tokens[i++],a=fn,b=product();
        fn=op==='+'?x=>a(x)+b(x):x=>a(x)-b(x);
      }
      return fn;
    }
    const fn=sum();
    if(i!==tokens.length)throw new Error('多余的符号：'+tokens[i]+'。');
    return fn;
  }

  const $=selector=>document.querySelector(selector);
  const form=$('#plot-form'),canvas=$('#plot-canvas'),ctx=canvas.getContext('2d');
  const inputs=[...form.querySelectorAll('[name=curve]')], coord=$('#plot-x');
  const names=['xmin','xmax','ymin','ymax'], colors=['#245cdb','#ac3b30','#087f69'];
  const presets={
    limit:{expr:['sin(x)/x','1'],bounds:[-10,10,-.4,1.35],caption:'x=0 处原式无定义（空心点）；左右两侧都趋近 1。',hole:true},
    equiv:{expr:['sin(x)','x'],bounds:[-2,2,-2,2],caption:'两条曲线在零点附近贴近；等价无穷小还需核对比值趋于 1。'},
    log:{expr:['ln(abs(x))'],bounds:[-5,5,-5,2],caption:'ln|x| 在 x=0 无定义，两侧曲线互不连接。'},
    odd:{expr:['x^3-x+1','0'],bounds:[-2.5,2.5,-5,5],caption:'用零线观察实根；多项式的连续性和两点异号给出零点存在。'}
  };
  let bounds=presets.limit.bounds.slice(),home=bounds.slice(),curves=[],probe=0,showHole=false,drag=null;
  const format=x=>Math.abs(x)>1e5||(x!==0&&Math.abs(x)<1e-4)?x.toExponential(3):String(Number(x.toPrecision(6)));
  const rangeOk=b=>b.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e9)
    &&b[1]-b[0]>=1e-7&&b[3]-b[2]>=1e-7;
  const updateRanges=()=>names.forEach((name,i)=>{form.elements[name].value=Number(bounds[i].toPrecision(12));});
  function dimensions(){
    const width=canvas.clientWidth,height=canvas.clientHeight;
    if(!width||!height)return null;
    return {width,height,l:48,r:width-15,t:14,b:height-30};
  }
  function readout(){
    $('#plot-readout').textContent='x = '+format(probe)+'；'+curves.map(c=>{
      const y=c.fn(probe);
      return '曲线 '+(c.index+1)+'：'+(Number.isFinite(y)?format(y):'未定义');
    }).join('　');
  }
  function draw(){
    const d=dimensions();if(!d||!ctx)return;
    const {width,height,l,r,t,b}=d,[xmin,xmax,ymin,ymax]=bounds;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,width,height);
    const X=x=>l+(r-l)*(x-xmin)/(xmax-xmin),Y=y=>b-(b-t)*(y-ymin)/(ymax-ymin);
    const toX=px=>xmin+(px-l)*(xmax-xmin)/(r-l);
    const line=(a,c,f,g,color)=>{ctx.beginPath();ctx.moveTo(a,c);ctx.lineTo(f,g);ctx.strokeStyle=color;ctx.stroke();};
    function ticks(lo,hi,count,cb){
      const rough=(hi-lo)/count,mag=10**Math.floor(Math.log10(rough));
      const step=([1,2,5,10].find(v=>v*mag>=rough)||10)*mag;
      const first=Math.ceil(lo/step);
      for(let j=0;j<20&&(first+j)*step<=hi;j++)cb((first+j)*step);
    }
    ctx.font='11px system-ui';ctx.fillStyle='#506580';ctx.lineWidth=1;
    ticks(xmin,xmax,Math.max(3,(r-l)/68),x=>{
      const px=X(x);line(px,t,px,b,'#e4ebf6');ctx.textAlign='center';ctx.fillText(format(x),px,b+17);
    });
    ticks(ymin,ymax,(b-t)/45,y=>{
      const py=Y(y);line(l,py,r,py,'#e4ebf6');ctx.textAlign='right';ctx.fillText(format(y),l-5,py+3);
    });
    ctx.strokeStyle='#c8d5e7';ctx.strokeRect(l,t,r-l,b-t);
    ctx.save();ctx.beginPath();ctx.rect(l,t,r-l,b-t);ctx.clip();
    if(xmin<=0&&xmax>=0)line(X(0),t,X(0),b,'#8297b3');
    if(ymin<=0&&ymax>=0)line(l,Y(0),r,Y(0),'#8297b3');
    const count=Math.ceil((r-l)*1.4);
    for(const curve of curves){
      ctx.beginPath();ctx.strokeStyle=colors[curve.index];ctx.lineWidth=2;
      let last=null;
      for(let i=0;i<=count;i++){
        const px=l+(r-l)*i/count,x=toX(px),py=Y(curve.fn(x));
        if(!Number.isFinite(py)){last=null;continue;}
        // Do not bridge a discontinuity or draw unbounded canvas coordinates.
        const middle=last?Y(curve.fn((x+last.x)/2)):py;
        const off=y=>y<t||y>b;
        const opposite=last&&((py<t&&last.py>b)||(py>b&&last.py<t));
        const jump=last&&Math.abs(py-last.py)>(b-t)*.8&&
          (off(py)&&off(last.py)||!Number.isFinite(middle)||Math.abs(middle-(py+last.py)/2)>(b-t)*.35);
        const bounded=Math.max(t-3*(b-t),Math.min(b+3*(b-t),py));
        if(!last||opposite||jump||!Number.isFinite(middle))ctx.moveTo(px,bounded);
        else ctx.lineTo(px,bounded);
        last={x,py};
      }
      ctx.stroke();
    }
    if(probe>=xmin&&probe<=xmax){
      const px=X(probe);
      ctx.setLineDash([4,4]);ctx.lineWidth=1;line(px,t,px,b,'#7688a4');ctx.setLineDash([]);
      for(const c of curves){
        const y=c.fn(probe);
        if(y>=ymin&&y<=ymax){
          ctx.beginPath();ctx.arc(px,Y(y),3.4,0,Math.PI*2);ctx.fillStyle=colors[c.index];ctx.fill();
        }
      }
    }
    if(showHole&&xmin<=0&&xmax>=0&&ymin<=1&&ymax>=1){
      ctx.beginPath();ctx.arc(X(0),Y(1),4.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=colors[0];ctx.lineWidth=2;ctx.stroke();
    }
    ctx.restore();readout();
  }
  function setBounds(next){
    if(!rangeOk(next))return;
    bounds=next;updateRanges();draw();
  }
  function plot(){
    try{
      const next=names.map(n=>form.elements[n].valueAsNumber);
      if(!rangeOk(next))throw new Error('请输入有效范围：最小值须小于最大值，坐标绝对值不超过 10⁹。');
      const parsed=inputs.flatMap((el,index)=>{
        if(!el.value.trim())return [];
        try{return [{index,fn:compile(el.value)}];}
        catch(error){throw new Error('曲线 '+(index+1)+'：'+error.message);}
      });
      if(!parsed.length)throw new Error('至少输入一条函数。');
      curves=parsed;showHole=false;home=next.slice();$('#plot-error').textContent='';
      $('#plot-caption').textContent='';
      setBounds(next);
    }catch(error){$('#plot-error').textContent=error.message;}
  }
  function preset(key){
    const p=presets[key];if(!p)return;
    inputs.forEach((el,i)=>{el.value=p.expr[i]||'';});
    curves=p.expr.map((expr,index)=>({index,fn:compile(expr)}));
    showHole=Boolean(p.hole);home=p.bounds.slice();
    probe=0;coord.value='0';
    $('#plot-error').textContent='';$('#plot-caption').textContent=p.caption;
    setBounds(p.bounds.slice());
  }
  function zoom(factor,rx=.5,ry=.5){
    const [x0,x1,y0,y1]=bounds,x=x0+(x1-x0)*rx,y=y0+(y1-y0)*ry;
    setBounds([x+(x0-x)*factor,x+(x1-x)*factor,y+(y0-y)*factor,y+(y1-y)*factor]);
  }
  function relative(event){
    const rect=canvas.getBoundingClientRect(),d=dimensions();
    return [(event.clientX-rect.left-d.l)/(d.r-d.l),1-(event.clientY-rect.top-d.t)/(d.b-d.t)];
  }
  function moveProbe(x){
    if(!Number.isFinite(x))return;
    probe=x;coord.value=Number(x.toPrecision(10));draw();
  }
  form.addEventListener('submit',event=>{event.preventDefault();plot();});
  coord.addEventListener('input',()=>{if(Number.isFinite(coord.valueAsNumber)){probe=coord.valueAsNumber;draw();}});
  $('#plot-zoom-in').addEventListener('click',()=>zoom(.75));
  $('#plot-zoom-out').addEventListener('click',()=>zoom(1/.75));
  $('#plot-reset').addEventListener('click',()=>setBounds(home.slice()));
  canvas.addEventListener('wheel',event=>{
    if(!dimensions())return;
    event.preventDefault();zoom(event.deltaY>0?1.2:1/1.2,...relative(event));
  },{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const [x,y]=relative(event);
    drag={x,y,bounds:bounds.slice(),id:event.pointerId};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dimensions())return;
    const [x,y]=relative(event);
    if(drag&&drag.id===event.pointerId){
      const [x0,x1,y0,y1]=drag.bounds,dx=(drag.x-x)*(x1-x0),dy=(drag.y-y)*(y1-y0);
      setBounds([x0+dx,x1+dx,y0+dy,y1+dy]);
    }
    if(x>=0&&x<=1)moveProbe(bounds[0]+x*(bounds[1]-bounds[0]));
  });
  canvas.addEventListener('lostpointercapture',()=>{drag=null;});
  canvas.addEventListener('keydown',event=>{
    const [x0,x1,y0,y1]=bounds,dx=(x1-x0)*.12,dy=(y1-y0)*.12;
    const shifts={ArrowLeft:[-dx,0],ArrowRight:[dx,0],ArrowUp:[0,dy],ArrowDown:[0,-dy]};
    if(event.key==='+'||event.key==='=')zoom(.75);
    else if(event.key==='-')zoom(1/.75);
    else if(Object.hasOwn(shifts,event.key)){
      const [x,y]=shifts[event.key];setBounds([x0+x,x1+x,y0+y,y1+y]);
    }else return;
    event.preventDefault();
  });
  new ResizeObserver(draw).observe(canvas);
  window.MathPlot={render:draw,preset};
  preset('limit');
})();
