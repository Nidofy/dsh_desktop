// Elapsed-time playback: unused atlas cells never enter an animation.
export function frameAt(animation,elapsed){
  const total=animation.durationsMs.reduce((a,b)=>a+b,0);
  if(!animation.loop&&elapsed>=total)return {column:animation.frameCount-1,done:true,remaining:0};
  let t=Math.max(0,elapsed)%total;
  for(let column=0;column<animation.frameCount;column++){if(t<animation.durationsMs[column])return {column,done:false,remaining:animation.durationsMs[column]-t};t-=animation.durationsMs[column];}
  throw Error('Invalid animation durations');
}
