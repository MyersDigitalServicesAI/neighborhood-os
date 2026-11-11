// Binary feature order matches neighborhood.screen. These synthetic cases describe
// signal patterns, not real user reviews or verification outcomes.
const features = ['affiliation','duplicate','incentive','promotion','personal','abuse','repetition'];
const patterns = [
  {priority:false, signals:['','','','','','','','','','','','', '0001000','0001000','0000001','1000000']},
  {priority:true, signals:['1100000','0100000','0101000','0100001','0010000','0011000','1010000','0010000',
    '0000100','0000100','0001100','0000010','0000010','0000110','1001000','0001001','1000001','0111000',
    '0001101','1100100','0011001','1000010']}
];

const count = patterns.reduce((total, group) => total + group.signals.length, 0);
const stats = patterns.map(({signals}) => ({
  prior: (signals.length + 1) / (count + patterns.length),
  rate: features.map((_, index) => (signals.filter((entry) => entry[index] === '1').length + 1) / (signals.length + 2))
}));
const [standard, priority] = stats;
const intercept = Math.log(priority.prior / standard.prior) +
  priority.rate.reduce((acc, rate, index) => acc + Math.log((1 - rate) / (1 - standard.rate[index])),0);
const weights = priority.rate.map((rate,index) =>
  Math.log((rate / (1 - rate)) / (standard.rate[index] / (1 - standard.rate[index]))));
const round = (value) => Number(value.toFixed(6));
console.log(JSON.stringify({ intercept:round(intercept),
  weights:Object.fromEntries(features.map((key,index)=>[key,round(weights[index])])) }));
