var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n));function l(e){return e==null||typeof e!=`object`&&typeof e!=`function`}function u(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function d(e){if(l(e))return e;if(Array.isArray(e)||u(e)||e instanceof ArrayBuffer||typeof SharedArrayBuffer<`u`&&e instanceof SharedArrayBuffer)return e.slice(0);let t=Object.getPrototypeOf(e),n=t.constructor;if(e instanceof Date||e instanceof Map||e instanceof Set)return new n(e);if(e instanceof RegExp){let t=new n(e);return t.lastIndex=e.lastIndex,t}if(e instanceof DataView)return new n(e.buffer.slice(0));if(e instanceof Error){let t=new n(e.message);return t.stack=e.stack,t.name=e.name,t.cause=e.cause,t}if(typeof File<`u`&&e instanceof File)return new n([e],e.name,{type:e.type,lastModified:e.lastModified});if(typeof e==`object`){let n=Object.create(t);return Object.assign(n,e)}return e}var f=o((exports=>{Object.defineProperty(exports,`__esModule`,{value:!0}),exports.pluralize=o,exports.singularize=s,exports.camelize=c;let t=`accommodation.adulthood.advertising.advice.aggression.aid.air.aircraft.alcohol.anger.applause.arithmetic.assistance.athletics.bacon.baggage.beef.biology.blood.botany.bread.butter.carbon.cardboard.cash.chalk.chaos.chess.crossroads.countryside.dancing.deer.dignity.dirt.dust.economics.education.electricity.engineering.enjoyment.envy.equipment.ethics.evidence.evolution.fame.fiction.flour.flu.food.fuel.fun.furniture.gallows.garbage.garlic.genetics.gold.golf.gossip.gratitude.grief.guilt.gymnastics.happiness.hardware.harm.hate.hatred.health.heat.help.homework.honesty.honey.hospitality.housework.humour.hunger.hydrogen.ice.importance.inflation.information.innocence.iron.irony.jam.jewelry.judo.karate.knowledge.lack.laughter.lava.leather.leisure.lightning.linguine.linguini.linguistics.literature.litter.livestock.logic.loneliness.luck.luggage.macaroni.machinery.magic.management.mankind.marble.mathematics.mayonnaise.measles.methane.milk.minus.money.mud.music.mumps.nature.news.nitrogen.nonsense.nurture.nutrition.obedience.obesity.oxygen.pasta.patience.physics.poetry.pollution.poverty.pride.psychology.publicity.punctuation.quartz.racism.relaxation.reliability.research.respect.revenge.rice.rubbish.rum.safety.scenery.seafood.seaside.series.shame.sheep.shopping.sleep.smoke.smoking.snow.soap.software.soil.spaghetti.species.steam.stuff.stupidity.sunshine.symmetry.tennis.thirst.thunder.timber.traffic.transportation.trust.underwear.unemployment.unity.validity.veal.vegetation.vegetarianism.vengeance.violence.vitality.warmth.wealth.weather.welfare.wheat.wildlife.wisdom.yoga.zinc.zoology`.split(`.`),n={plural:{men:RegExp(`^(m|wom)en$`,`gi`),people:RegExp(`(pe)ople$`,`gi`),children:RegExp(`(child)ren$`,`gi`),tia:RegExp(`([ti])a$`,`gi`),analyses:RegExp(`((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$`,`gi`),databases:RegExp(`(database)s$`,`gi`),drives:RegExp(`(drive)s$`,`gi`),hives:RegExp(`(hi|ti)ves$`,`gi`),curves:RegExp(`(curve)s$`,`gi`),lrves:RegExp(`([lr])ves$`,`gi`),aves:RegExp(`([a])ves$`,`gi`),foves:RegExp(`([^fo])ves$`,`gi`),movies:RegExp(`(m)ovies$`,`gi`),aeiouyies:RegExp(`([^aeiouy]|qu)ies$`,`gi`),series:RegExp(`(s)eries$`,`gi`),xes:RegExp(`(x|ch|ss|sh)es$`,`gi`),mice:RegExp(`([m|l])ice$`,`gi`),buses:RegExp(`(bus)es$`,`gi`),oes:RegExp(`(o)es$`,`gi`),shoes:RegExp(`(shoe)s$`,`gi`),crises:RegExp(`(cris|ax|test)es$`,`gi`),octopuses:RegExp(`(octop|vir)uses$`,`gi`),aliases:RegExp(`(alias|canvas|status|campus)es$`,`gi`),summonses:RegExp(`^(summons|bonus)es$`,`gi`),oxen:RegExp(`^(ox)en`,`gi`),matrices:RegExp(`(matr)ices$`,`gi`),vertices:RegExp(`(vert|ind)ices$`,`gi`),feet:RegExp(`^feet$`,`gi`),teeth:RegExp(`^teeth$`,`gi`),geese:RegExp(`^geese$`,`gi`),quizzes:RegExp(`(quiz)zes$`,`gi`),whereases:RegExp(`^(whereas)es$`,`gi`),criteria:RegExp(`^(criteri)a$`,`gi`),genera:RegExp(`^genera$`,`gi`),ss:RegExp(`ss$`,`gi`),s:RegExp(`s$`,`gi`)},singular:{man:RegExp(`^(m|wom)an$`,`gi`),person:RegExp(`(pe)rson$`,`gi`),child:RegExp(`(child)$`,`gi`),drive:RegExp(`(drive)$`,`gi`),ox:RegExp(`^(ox)$`,`gi`),axis:RegExp(`(ax|test)is$`,`gi`),octopus:RegExp(`(octop|vir)us$`,`gi`),alias:RegExp(`(alias|status|canvas|campus)$`,`gi`),summons:RegExp(`^(summons|bonus)$`,`gi`),bus:RegExp(`(bu)s$`,`gi`),buffalo:RegExp(`(buffal|tomat|potat)o$`,`gi`),tium:RegExp(`([ti])um$`,`gi`),sis:RegExp(`sis$`,`gi`),ffe:RegExp(`(?:([^f])fe|([lr])f)$`,`gi`),focus:RegExp(`^(focus)$`,`gi`),hive:RegExp(`(hi|ti)ve$`,`gi`),aeiouyy:RegExp(`([^aeiouy]|qu)y$`,`gi`),x:RegExp(`(x|ch|ss|sh)$`,`gi`),matrix:RegExp(`(matr)ix$`,`gi`),vertex:RegExp(`(vert|ind)ex$`,`gi`),mouse:RegExp(`([m|l])ouse$`,`gi`),foot:RegExp(`^foot$`,`gi`),tooth:RegExp(`^tooth$`,`gi`),goose:RegExp(`^goose$`,`gi`),quiz:RegExp(`(quiz)$`,`gi`),whereas:RegExp(`^(whereas)$`,`gi`),criterion:RegExp(`^(criteri)on$`,`gi`),genus:RegExp(`^genus$`,`gi`),s:RegExp(`s$`,`gi`),common:RegExp(`$`,`gi`)}},r=[[n.plural.men],[n.plural.people],[n.plural.children],[n.plural.tia],[n.plural.analyses],[n.plural.databases],[n.plural.drives],[n.plural.hives],[n.plural.curves],[n.plural.lrves],[n.plural.foves],[n.plural.aeiouyies],[n.plural.series],[n.plural.movies],[n.plural.xes],[n.plural.mice],[n.plural.buses],[n.plural.oes],[n.plural.shoes],[n.plural.crises],[n.plural.octopuses],[n.plural.aliases],[n.plural.summonses],[n.plural.oxen],[n.plural.matrices],[n.plural.feet],[n.plural.teeth],[n.plural.geese],[n.plural.quizzes],[n.plural.whereases],[n.plural.criteria],[n.plural.genera],[n.singular.man,`$1en`],[n.singular.person,`$1ople`],[n.singular.child,`$1ren`],[n.singular.drive,`$1s`],[n.singular.ox,`$1en`],[n.singular.axis,`$1es`],[n.singular.octopus,`$1uses`],[n.singular.alias,`$1es`],[n.singular.summons,`$1es`],[n.singular.bus,`$1ses`],[n.singular.buffalo,`$1oes`],[n.singular.tium,`$1a`],[n.singular.sis,`ses`],[n.singular.ffe,`$1$2ves`],[n.singular.focus,`$1es`],[n.singular.hive,`$1ves`],[n.singular.aeiouyy,`$1ies`],[n.singular.matrix,`$1ices`],[n.singular.vertex,`$1ices`],[n.singular.x,`$1es`],[n.singular.mouse,`$1ice`],[n.singular.foot,`feet`],[n.singular.tooth,`teeth`],[n.singular.goose,`geese`],[n.singular.quiz,`$1zes`],[n.singular.whereas,`$1es`],[n.singular.criterion,`$1a`],[n.singular.genus,`genera`],[n.singular.s,`s`],[n.singular.common,`s`]],i=[[n.singular.man],[n.singular.person],[n.singular.child],[n.singular.drive],[n.singular.ox],[n.singular.axis],[n.singular.octopus],[n.singular.alias],[n.singular.summons],[n.singular.bus],[n.singular.buffalo],[n.singular.tium],[n.singular.sis],[n.singular.ffe],[n.singular.focus],[n.singular.hive],[n.singular.aeiouyy],[n.singular.x],[n.singular.matrix],[n.singular.mouse],[n.singular.foot],[n.singular.tooth],[n.singular.goose],[n.singular.quiz],[n.singular.whereas],[n.singular.criterion],[n.singular.genus],[n.plural.men,`$1an`],[n.plural.people,`$1rson`],[n.plural.children,`$1`],[n.plural.databases,`$1`],[n.plural.drives,`$1`],[n.plural.genera,`genus`],[n.plural.criteria,`$1on`],[n.plural.tia,`$1um`],[n.plural.analyses,`$1$2sis`],[n.plural.hives,`$1ve`],[n.plural.curves,`$1`],[n.plural.lrves,`$1f`],[n.plural.aves,`$1ve`],[n.plural.foves,`$1fe`],[n.plural.movies,`$1ovie`],[n.plural.aeiouyies,`$1y`],[n.plural.series,`$1eries`],[n.plural.xes,`$1`],[n.plural.mice,`$1ouse`],[n.plural.buses,`$1`],[n.plural.oes,`$1`],[n.plural.shoes,`$1`],[n.plural.crises,`$1is`],[n.plural.octopuses,`$1us`],[n.plural.aliases,`$1`],[n.plural.summonses,`$1`],[n.plural.oxen,`$1`],[n.plural.matrices,`$1ix`],[n.plural.vertices,`$1ex`],[n.plural.feet,`foot`],[n.plural.teeth,`tooth`],[n.plural.geese,`goose`],[n.plural.quizzes,`$1`],[n.plural.whereases,`$1`],[n.plural.ss,`ss`],[n.plural.s,``]];function a(e,t,n,r){if(r)return r;if(n.includes(e.toLocaleLowerCase()))return e;for(let n of t)if(e.match(n[0]))return n[1]===void 0?e:e.replace(n[0],n[1]);return e}function o(e,n){return a(e,r,t,n)}function s(e,n){return a(e,i,t,n)}function c(e,t){let n=e.split(`/`),r=n.length,i,a,o,s;for(let e=0;e<r;e++){for(i=n[e].split(`_`),a=0,o=i.length;a<o;a++)a!==0&&(i[a]=i[a].toLowerCase()),s=i[a].charAt(0),s=t&&e===0&&a===0?s.toLowerCase():s.toUpperCase(),i[a]=s+i[a].substring(1);n[e]=i.join(``)}return n.join(`::`)}}));function p(e){let t=e.match(/^[ \t]+/);return t?t[0]:``}function m(e){let t=e.match(/(?<=(\r\n|\r|\n))[ \t]+$/);return t?t[0]:``}function h(e,...t){let n=``,r=(typeof e==`string`?e.split(/(?=\r\n|\r|\n)/):e.map(e=>e)).map((e,r)=>(e.match(/\r\n|\r|\n/)&&(n=m(e)||n),e+(t[r]||``).replace(/\r\n|\r|\n/g,`
`+n))).join(``).split(/\r\n|\r|\n/),i=Math.min(...r.filter(e=>!!e.match(/[^ \t]/)).map(e=>p(e).length));return r.map(e=>e.slice(i)).join(`
`).replace(/^\n|\n[ \t]*$/g,``)}var g=c(f(),1);function _(e){return e.map(e=>typeof e==`string`?{value:e,description:``}:{...e,description:e.description??``})}var v=class{_output=null;constructor(e){this.fields=e}},y=class e{_metadata;_defined=void 0;_output=void 0;get metadata(){return{...this._metadata}}constructor(e,t,n,r){this.fields=n,this._metadata={type:e,required:!0},t&&(t.optional===!0&&(this._metadata.required=!1,t.assertNonNull===!0&&(this._metadata.assertNonNull=!0)),t.array===!0&&(this._metadata.array=!0)),r&&(this._metadata.allowedValues=_(r))}static create(t,n,r,i){return new e(t,n,r,i)}description(e){return this._metadata.description=e,this}};y.create;const b={"=":`eq`,"!=":`ne`,in:`in`,"not in":`nin`};function x(e){return typeof e==`object`&&`user`in e?{user:{id:`_id`}[e.user]??e.user}:e}function S(e){return e.map(e=>{let[t,n,r]=e;return[x(t),b[n],x(r)]})}function C(e){return typeof e==`object`&&!!e&&`conditions`in e}function w(e){return e.length>=2&&typeof e[1]==`string`}function T(e){return Object.keys(e).reduce((t,n)=>(t[n]=e[n].map(e=>D(e)),t),{})}function E(e){return e.map(e=>ee(e))}function ee(e){return{conditions:e.conditions?S(e.conditions):[],actions:e.actions===`all`?[`all`]:e.actions,permit:e.permit?`allow`:`deny`,description:e.description}}function D(e){if(C(e))return{conditions:S(w(e.conditions)?[e.conditions]:e.conditions),permit:e.permit?`allow`:`deny`,description:e.description};if(w(e)){let[t,n,r,i]=[...e,!0];return{conditions:S([[t,n,r]]),permit:i?`allow`:`deny`}}let t=[],n=e,r=!0;for(let e of n){if(typeof e==`boolean`){r=e;continue}t.push(e)}return{conditions:S(t),permit:r?`allow`:`deny`}}const O=class e extends y{_ref=void 0;get reference(){return d(this._ref)}get metadata(){return{...this._metadata}}get config(){return{...this._metadata,validate:this._metadata.validate?.map(e=>{let{fn:t,message:n}=typeof e==`function`?{fn:e,message:`failed by \`${e.toString().trim()}\``}:{fn:e[0],message:e[1]};return{script:{expr:`(${t.toString().trim()})({ value: _value, user })`},errorMessage:n}}),hooks:this._metadata.hooks?{create:this._metadata.hooks.create?{expr:`(${this._metadata.hooks.create.toString().trim()})({ value: _value, data: _data, user })`}:void 0,update:this._metadata.hooks.update?{expr:`(${this._metadata.hooks.update.toString().trim()})({ value: _value, data: _data, user })`}:void 0}:void 0,serial:this._metadata.serial?{start:this._metadata.serial.start,maxValue:this._metadata.serial.maxValue,format:`format`in this._metadata.serial?this._metadata.serial.format:void 0}:void 0}}constructor(e,t,n,r){super(e,t,n,r)}static create(t,n,r,i){return new e(t,n,r,i)}description(e){return super.description(e)}relation(e){let t=this,n=e?.toward?.type===`self`;if(t._metadata.index=!0,t._metadata.foreignKey=!0,t._metadata.unique=[`oneToOne`,`1-1`].includes(e.type),!n){let n=e.toward.type;t._metadata.foreignKeyType=n.name}if(e.type===`keyOnly`)return t;let r=e?.toward?.key??`id`,i=e?.backward??``;if(n){let n=e;return t._pendingSelfRelation={as:n.toward.as,key:r,backward:i,relationType:n.type},t._metadata.relation=!0,t}let a=e,o=a.toward.type,s=a.toward.as??g.camelize(o.name,!0);return this._ref={type:o,nameMap:[s,i],key:r},t._metadata.relation=!0,t}index(){return this._metadata.index=!0,this}unique(){return this._metadata.unique=!0,this._metadata.index=!0,this}vector(){return this._metadata.vector=!0,this}hooks(e){return this._metadata.hooks=e,this}validate(...e){return this._metadata.validate=e,this}serial(e){return this._metadata.serial=e,this}}.create;function k(e){return O(`uuid`,e)}function A(e){return O(`string`,e)}function j(e){return O(`boolean`,e)}function M(e){return O(`integer`,e)}function N(e){return O(`float`,e)}function P(e){return O(`date`,e)}function F(e){return O(`datetime`,e)}function I(e){return O(`time`,e)}function L(...e){let t,n,r=e[e.length-1];return typeof r==`object`&&!(`value`in r)?(t=e.slice(0,-1),n=r):(t=e,n=void 0),O(`enum`,n,void 0,t)}function R(e,t){return O(`nested`,t,e)}var z=class extends v{referenced={};_description;_settings={};_indexes=[];_permissions={};_files={};constructor(e,t,n){super(t),this.name=e,this.fields=t,this._description=n.description;let r=n.pluralForm||g.pluralize(e);if(e===r)throw Error(`The name and the plural form must be different. name=${e}`);this._settings.pluralForm=r,Object.entries(this.fields).forEach(([e,t])=>{let n=t._pendingSelfRelation;if(n){let r=n.as??e.replace(/(ID|Id|id)$/u,``);t._ref={type:this,nameMap:[r,n.backward],key:n.key},t._metadata.foreignKeyType=this.name}}),Object.entries(this.fields).forEach(([e,t])=>{if(t.reference&&t.reference!==void 0){let n=t.reference;if(n.type){let r=n.nameMap?.[1];if(!r||r===``){let e=g.camelize(this.name,!0);r=t.metadata?.unique?g.singularize(e):g.pluralize(e)}n.type.referenced[r]=[this,e]}}})}get metadata(){let e=Object.entries(this.fields).reduce((e,[t,n])=>(e[t]=n.config,e),{}),t={};return this._indexes&&this._indexes.length>0&&this._indexes.forEach(e=>{let n=e.fields.map(e=>String(e)),r=e.name||`idx_${n.join(`_`)}`;t[r]={fields:n,unique:e.unique}}),{name:this.name,schema:{description:this._description,extends:!1,fields:e,settings:this._settings,permissions:this._permissions,files:this._files,...Object.keys(t).length>0&&{indexes:t}}}}hooks(e){return Object.entries(e).forEach(([e,t])=>{this.fields[e].hooks(t)}),this}validate(e){return Object.entries(e).forEach(([e,t])=>{let n=this.fields[e],r=t;Array.isArray(r)?(e=>Array.isArray(e)&&e.length===2&&typeof e[1]==`string`)(r)?n.validate(r):n.validate(...r):n.validate(r)}),this}features(e){return this._settings={...this._settings,...e},this}indexes(...e){return this._indexes=e,this}files(e){return this._files=e,this}permission(e){let t=this;return t._permissions.record=T(e),t}gqlPermission(e){let t=this;return t._permissions.gql=E(e),t}};const B=k();function V(e,t,n){let r=Array.isArray(e)?e[0]:e,i=Array.isArray(e)?e[1]:void 0,a,o;return typeof t==`string`?(a=t,o=n):o=t,new z(r,{id:B,...o},{pluralForm:i,description:a})}const H={type:V,uuid:k,string:A,bool:j,int:M,float:N,date:P,datetime:F,time:I,enum:L,object:R,fields:{timestamps:()=>({createdAt:F({optional:!0,assertNonNull:!0}).hooks({create:()=>new Date().toISOString()}),updatedAt:F({optional:!0}).hooks({update:()=>new Date().toISOString()})})}};h`
  import { SqlClient } from "@tailor-platform/tailor-sdk";
  import {
    ColumnType,
    DummyDriver,
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    type CompiledQuery,
  } from "kysely";

  type ArrayType<T> = ArrayTypeImpl<T> extends (infer U)[]
    ? U[]
    : ArrayTypeImpl<T>;
  type ArrayTypeImpl<T> = T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S[], I[], U[]>
    : T[];
  type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
  type Json = JsonValue;
  type JsonArray = JsonValue[];
  type JsonObject = {
    [x: string]: JsonValue | undefined;
  };
  type JsonPrimitive = boolean | number | string | null;
  type JsonValue = JsonArray | JsonObject | JsonPrimitive;
  type Timestamp = ColumnType<Date, Date | string, Date | string>;
`,h`
  const getDB = () => {
    return new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
  };

  type QueryReturnType<T> = T extends CompiledQuery<infer U> ? U : never;

  export async function kyselyWrapper<const C extends { client: SqlClient }, R>(
    context: C,
    callback: (
      context: Omit<C, "client"> & {
        db: ReturnType<typeof getDB>;
        client: {
          exec: <Q extends CompiledQuery>(
            query: Q,
          ) => Promise<QueryReturnType<Q>[]>;
        };
      },
    ) => Promise<R>,
  ) {
    const db = getDB();
    const clientWrapper = {
      exec: async <Q extends CompiledQuery>(query: Q) => {
        return await context.client.exec<QueryReturnType<Q>[]>(query.sql, query.parameters);
      },
    };

    return await callback({ ...context, db, client: clientWrapper });
  }
`,h`
  const $connect_tailordb = async (namespace) => {
    const baseClient = namespace ? new tailordb.Client({ namespace }) : { connect: () => {}, end: () => {} };
    await baseClient.connect();

    const client = {
      async exec(query, params) {
        const result = await baseClient.queryObject(query, params ?? []);
        return result.rows;
      },
      async execOne(query, params) {
        const result = await baseClient.queryObject(query, params ?? []);
        return result.rows[0];
      },
    };
    return {
      ...client,
      async transaction(callback) {
        try {
          await client.exec("BEGIN");
          const result = await callback(client);
          await client.exec("COMMIT");
          return result;
        } catch (e) {
          console.error("Transaction failed:", e);
          try {
            await client.exec("ROLLBACK");
          } catch (e) {
            console.error("Failed to rollback transaction:", e);
          }
        }
      },
      async end() {
        try {
          await baseClient.end();
        } catch (e) {
          console.error("Error ending connection:", e);
        }
      }
    };
  };

  const ${`$tailor_db_wrapper`} = async (namespace, fn) => {
    return async (args) => {
      const client = await $connect_tailordb(namespace);
      try {
        return await fn({ ...args, client });
      } finally {
        await client.end();
      }
    };
  };
`;function U({name:e,fn:t,variables:n,dbNamespace:r,jobFunction:i,invoker:a}){let o=`({ ...args, appNamespace: args.namespaceName })`;return{manifest:{Kind:i?`job_function`:`function`,Name:e,Variables:{Expr:n?`(${n.toString()})${o}`:o},Invoker:a?{AuthNamespace:a.authName,MachineUserName:a.machineUser}:void 0},context:{args:{},fn:t,dbNamespace:r}}}function W({appName:e,query:t,variables:n,invoker:r}){return{manifest:{Kind:`graphql`,AppName:e,Query:t.toString(),Variables:n?{Expr:`(${n.toString()})(args)`}:void 0,Invoker:r?{AuthNamespace:r.authName,MachineUserName:r.machineUser}:void 0},context:{args:void 0}}}function G({url:e,headers:t,body:n}){return{manifest:{Kind:`webhook`,URL:{Expr:`(${e.toString()})(args)`},Headers:t?Object.entries(t).filter(([e,t])=>t!=null).map(([e,t])=>({Key:e,Value:typeof t==`string`?t:{VaultName:t.vault,SecretKey:t.key}})):void 0,Body:n?{Expr:`(${n.toString()})(args)`}:void 0},context:{args:void 0}}}function K(e,t){return{on:n=>({executeFunction:({fn:r,variables:i,dbNamespace:a,invoker:o})=>{let s=U({name:`${e}__target`,fn:r,variables:i,dbNamespace:a,invoker:o});return{name:e,description:t,trigger:n,exec:s}},executeJobFunction:({fn:r,variables:i,dbNamespace:a,invoker:o})=>{let s=U({name:`${e}__target`,fn:r,variables:i,dbNamespace:a,invoker:o,jobFunction:!0});return{name:e,description:t,trigger:n,exec:s}},executeGql:r=>{let i=W(r);return{name:e,description:t,trigger:n,exec:i}},executeWebhook:r=>{let i=G(r);return{name:e,description:t,trigger:n,exec:i}}})}}function q(e,t){let n=`{ ...args, appNamespace: args.namespaceName }`;return{manifest:{Kind:`Event`,EventType:`tailordb.type_record.created`,Condition:{Expr:[`args.typeName === "${e.name}"`,...t?[`(${t.toString()})(${n})`]:[]].join(` && `)}},context:{args:{},type:e.name,variables:{expr:`(${n})`}}}}const J=[{user:`role`},`=`,`ADMIN`],Y=[{user:`_loggedIn`},`=`,!0],X={create:[J],read:[J,Y],update:[J],delete:[J]},Z=[{conditions:[J],actions:[`create`,`read`,`update`,`delete`,`aggregate`,`bulkUpsert`],permit:!0},{conditions:[Y],actions:[`read`],permit:!0}],Q=H.type(`User`,{name:H.string(),email:H.string().unique(),status:H.string({optional:!0}),department:H.string({optional:!0}),role:H.enum(`ADMIN`,`USER`),...H.fields.timestamps()}).files({avatar:`profile image`}).indexes({fields:[`name`,`department`],unique:!1},{fields:[`status`,`createdAt`],unique:!1,name:`user_status_created_idx`}).permission(X).gqlPermission(Z);var $=async({newRecord:e,client:t})=>{let n=await t.execOne(`select * from User where id = ?`,[e.id]);console.log(`New user created: ${n.name} (${n.email})`)};K(`user-created`,`Triggered when a new user is created`).on(q(Q,({newRecord:e})=>e.email.endsWith(`@tailor.tech`))).executeFunction({fn:async e=>{await $(e)},dbNamespace:`tailordb`});const te=async e=>{await $(e)},ne=async e=>{let t=e?new tailordb.Client({namespace:e}):{connect:()=>{},end:()=>{}};await t.connect();let n={async exec(e,n){return(await t.queryObject(e,n??[])).rows},async execOne(e,n){return(await t.queryObject(e,n??[])).rows[0]}};return{...n,async transaction(e){try{await n.exec(`BEGIN`);let t=await e(n);return await n.exec(`COMMIT`),t}catch(e){console.error(`Transaction failed:`,e);try{await n.exec(`ROLLBACK`)}catch(e){console.error(`Failed to rollback transaction:`,e)}}},async end(){try{await t.end()}catch(e){console.error(`Error ending connection:`,e)}}}};globalThis.main=await(async(e,t)=>async n=>{let r=await ne(e);try{return await t({...n,client:r})}finally{await r.end()}})(`tailordb`,te);
//# sourceMappingURL=user-created.js.map