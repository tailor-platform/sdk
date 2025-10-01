var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n));function l(e){return e==null||typeof e!=`object`&&typeof e!=`function`}function u(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function d(e){if(l(e))return e;if(Array.isArray(e)||u(e)||e instanceof ArrayBuffer||typeof SharedArrayBuffer<`u`&&e instanceof SharedArrayBuffer)return e.slice(0);let t=Object.getPrototypeOf(e),n=t.constructor;if(e instanceof Date||e instanceof Map||e instanceof Set)return new n(e);if(e instanceof RegExp){let t=new n(e);return t.lastIndex=e.lastIndex,t}if(e instanceof DataView)return new n(e.buffer.slice(0));if(e instanceof Error){let t=new n(e.message);return t.stack=e.stack,t.name=e.name,t.cause=e.cause,t}if(typeof File<`u`&&e instanceof File)return new n([e],e.name,{type:e.type,lastModified:e.lastModified});if(typeof e==`object`){let n=Object.create(t);return Object.assign(n,e)}return e}var f=c(o((exports=>{Object.defineProperty(exports,`__esModule`,{value:!0}),exports.camelize=n;let t={plural:{men:RegExp(`^(m|wom)en$`,`gi`),people:RegExp(`(pe)ople$`,`gi`),children:RegExp(`(child)ren$`,`gi`),tia:RegExp(`([ti])a$`,`gi`),analyses:RegExp(`((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$`,`gi`),databases:RegExp(`(database)s$`,`gi`),drives:RegExp(`(drive)s$`,`gi`),hives:RegExp(`(hi|ti)ves$`,`gi`),curves:RegExp(`(curve)s$`,`gi`),lrves:RegExp(`([lr])ves$`,`gi`),aves:RegExp(`([a])ves$`,`gi`),foves:RegExp(`([^fo])ves$`,`gi`),movies:RegExp(`(m)ovies$`,`gi`),aeiouyies:RegExp(`([^aeiouy]|qu)ies$`,`gi`),series:RegExp(`(s)eries$`,`gi`),xes:RegExp(`(x|ch|ss|sh)es$`,`gi`),mice:RegExp(`([m|l])ice$`,`gi`),buses:RegExp(`(bus)es$`,`gi`),oes:RegExp(`(o)es$`,`gi`),shoes:RegExp(`(shoe)s$`,`gi`),crises:RegExp(`(cris|ax|test)es$`,`gi`),octopuses:RegExp(`(octop|vir)uses$`,`gi`),aliases:RegExp(`(alias|canvas|status|campus)es$`,`gi`),summonses:RegExp(`^(summons|bonus)es$`,`gi`),oxen:RegExp(`^(ox)en`,`gi`),matrices:RegExp(`(matr)ices$`,`gi`),vertices:RegExp(`(vert|ind)ices$`,`gi`),feet:RegExp(`^feet$`,`gi`),teeth:RegExp(`^teeth$`,`gi`),geese:RegExp(`^geese$`,`gi`),quizzes:RegExp(`(quiz)zes$`,`gi`),whereases:RegExp(`^(whereas)es$`,`gi`),criteria:RegExp(`^(criteri)a$`,`gi`),genera:RegExp(`^genera$`,`gi`),ss:RegExp(`ss$`,`gi`),s:RegExp(`s$`,`gi`)},singular:{man:RegExp(`^(m|wom)an$`,`gi`),person:RegExp(`(pe)rson$`,`gi`),child:RegExp(`(child)$`,`gi`),drive:RegExp(`(drive)$`,`gi`),ox:RegExp(`^(ox)$`,`gi`),axis:RegExp(`(ax|test)is$`,`gi`),octopus:RegExp(`(octop|vir)us$`,`gi`),alias:RegExp(`(alias|status|canvas|campus)$`,`gi`),summons:RegExp(`^(summons|bonus)$`,`gi`),bus:RegExp(`(bu)s$`,`gi`),buffalo:RegExp(`(buffal|tomat|potat)o$`,`gi`),tium:RegExp(`([ti])um$`,`gi`),sis:RegExp(`sis$`,`gi`),ffe:RegExp(`(?:([^f])fe|([lr])f)$`,`gi`),focus:RegExp(`^(focus)$`,`gi`),hive:RegExp(`(hi|ti)ve$`,`gi`),aeiouyy:RegExp(`([^aeiouy]|qu)y$`,`gi`),x:RegExp(`(x|ch|ss|sh)$`,`gi`),matrix:RegExp(`(matr)ix$`,`gi`),vertex:RegExp(`(vert|ind)ex$`,`gi`),mouse:RegExp(`([m|l])ouse$`,`gi`),foot:RegExp(`^foot$`,`gi`),tooth:RegExp(`^tooth$`,`gi`),goose:RegExp(`^goose$`,`gi`),quiz:RegExp(`(quiz)$`,`gi`),whereas:RegExp(`^(whereas)$`,`gi`),criterion:RegExp(`^(criteri)on$`,`gi`),genus:RegExp(`^genus$`,`gi`),s:RegExp(`s$`,`gi`),common:RegExp(`$`,`gi`)}};t.plural.men,t.plural.people,t.plural.children,t.plural.tia,t.plural.analyses,t.plural.databases,t.plural.drives,t.plural.hives,t.plural.curves,t.plural.lrves,t.plural.foves,t.plural.aeiouyies,t.plural.series,t.plural.movies,t.plural.xes,t.plural.mice,t.plural.buses,t.plural.oes,t.plural.shoes,t.plural.crises,t.plural.octopuses,t.plural.aliases,t.plural.summonses,t.plural.oxen,t.plural.matrices,t.plural.feet,t.plural.teeth,t.plural.geese,t.plural.quizzes,t.plural.whereases,t.plural.criteria,t.plural.genera,t.singular.man,t.singular.person,t.singular.child,t.singular.drive,t.singular.ox,t.singular.axis,t.singular.octopus,t.singular.alias,t.singular.summons,t.singular.bus,t.singular.buffalo,t.singular.tium,t.singular.sis,t.singular.ffe,t.singular.focus,t.singular.hive,t.singular.aeiouyy,t.singular.matrix,t.singular.vertex,t.singular.x,t.singular.mouse,t.singular.foot,t.singular.tooth,t.singular.goose,t.singular.quiz,t.singular.whereas,t.singular.criterion,t.singular.genus,t.singular.s,t.singular.common,t.singular.man,t.singular.person,t.singular.child,t.singular.drive,t.singular.ox,t.singular.axis,t.singular.octopus,t.singular.alias,t.singular.summons,t.singular.bus,t.singular.buffalo,t.singular.tium,t.singular.sis,t.singular.ffe,t.singular.focus,t.singular.hive,t.singular.aeiouyy,t.singular.x,t.singular.matrix,t.singular.mouse,t.singular.foot,t.singular.tooth,t.singular.goose,t.singular.quiz,t.singular.whereas,t.singular.criterion,t.singular.genus,t.plural.men,t.plural.people,t.plural.children,t.plural.databases,t.plural.drives,t.plural.genera,t.plural.criteria,t.plural.tia,t.plural.analyses,t.plural.hives,t.plural.curves,t.plural.lrves,t.plural.aves,t.plural.foves,t.plural.movies,t.plural.aeiouyies,t.plural.series,t.plural.xes,t.plural.mice,t.plural.buses,t.plural.oes,t.plural.shoes,t.plural.crises,t.plural.octopuses,t.plural.aliases,t.plural.summonses,t.plural.oxen,t.plural.matrices,t.plural.vertices,t.plural.feet,t.plural.teeth,t.plural.geese,t.plural.quizzes,t.plural.whereases,t.plural.ss,t.plural.s;function n(e,t){let n=e.split(`/`),r=n.length,i,a,o,s;for(let e=0;e<r;e++){for(i=n[e].split(`_`),a=0,o=i.length;a<o;a++)a!==0&&(i[a]=i[a].toLowerCase()),s=i[a].charAt(0),s=t&&e===0&&a===0?s.toLowerCase():s.toUpperCase(),i[a]=s+i[a].substring(1);n[e]=i.join(``)}return n.join(`::`)}}))(),1);function p(e){let t=e.match(/^[ \t]+/);return t?t[0]:``}function m(e){let t=e.match(/(?<=(\r\n|\r|\n))[ \t]+$/);return t?t[0]:``}function h(e,...t){let n=``,r=(typeof e==`string`?e.split(/(?=\r\n|\r|\n)/):e.map(e=>e)).map((e,r)=>(e.match(/\r\n|\r|\n/)&&(n=m(e)||n),e+(t[r]||``).replace(/\r\n|\r|\n/g,`
`+n))).join(``).split(/\r\n|\r|\n/),i=Math.min(...r.filter(e=>!!e.match(/[^ \t]/)).map(e=>p(e).length));return r.map(e=>e.slice(i)).join(`
`).replace(/^\n|\n[ \t]*$/g,``)}function g(e){return e.map(e=>typeof e==`string`?{value:e,description:``}:{...e,description:e.description??``})}var _=class{_output=null;constructor(e){this.fields=e}},v=class e{_metadata;_defined=void 0;_output=void 0;get metadata(){return{...this._metadata}}constructor(e,t,n,r){this.fields=n,this._metadata={type:e,required:!0},t&&(t.optional===!0&&(this._metadata.required=!1,t.assertNonNull===!0&&(this._metadata.assertNonNull=!0)),t.array===!0&&(this._metadata.array=!0)),r&&(this._metadata.allowedValues=g(r))}static create(t,n,r,i){return new e(t,n,r,i)}description(e){return this._metadata.description=e,this}};const y=v.create;function b(e){return y(`uuid`,e)}function x(e){return y(`string`,e)}function S(e){return y(`boolean`,e)}function C(e){return y(`integer`,e)}function w(e){return y(`float`,e)}function T(e){return y(`date`,e)}function E(e){return y(`datetime`,e)}function D(e){return y(`time`,e)}function O(...e){let t,n,r=e[e.length-1];return typeof r==`object`&&!(`value`in r)?(t=e.slice(0,-1),n=r):(t=e,n=void 0),y(`enum`,n,void 0,t)}function k(e,t){return y(`nested`,t,e)}function A(e){return new _(e)}const j={type:A,uuid:b,string:x,bool:S,int:C,float:w,date:T,datetime:E,time:D,enum:O,object:k},M=class e extends v{_ref=void 0;get reference(){return d(this._ref)}get metadata(){return{...this._metadata}}get config(){return{...this._metadata,validate:this._metadata.validate?.map(e=>{let{fn:t,message:n}=typeof e==`function`?{fn:e,message:`failed by \`${e.toString().trim()}\``}:{fn:e[0],message:e[1]};return{script:{expr:`(${t.toString().trim()})({ value: _value, user })`},errorMessage:n}}),hooks:this._metadata.hooks?{create:this._metadata.hooks.create?{expr:`(${this._metadata.hooks.create.toString().trim()})({ value: _value, data: _data, user })`}:void 0,update:this._metadata.hooks.update?{expr:`(${this._metadata.hooks.update.toString().trim()})({ value: _value, data: _data, user })`}:void 0}:void 0,serial:this._metadata.serial?{start:this._metadata.serial.start,maxValue:this._metadata.serial.maxValue,format:`format`in this._metadata.serial?this._metadata.serial.format:void 0}:void 0}}constructor(e,t,n,r){super(e,t,n,r)}static create(t,n,r,i){return new e(t,n,r,i)}description(e){return super.description(e)}relation(e){let t=this,n=e?.toward?.type===`self`;if(t._metadata.index=!0,t._metadata.foreignKey=!0,t._metadata.unique=[`oneToOne`,`1-1`].includes(e.type),!n){let n=e.toward.type;t._metadata.foreignKeyType=n.name}if(e.type===`keyOnly`)return t;let r=e?.toward?.key??`id`,i=e?.backward??``;if(n){let n=e;return t._pendingSelfRelation={as:n.toward.as,key:r,backward:i,relationType:n.type},t._metadata.relation=!0,t}let a=e,o=a.toward.type,s=a.toward.as??f.camelize(o.name,!0);return this._ref={type:o,nameMap:[s,i],key:r},t._metadata.relation=!0,t}index(){return this._metadata.index=!0,this}unique(){return this._metadata.unique=!0,this._metadata.index=!0,this}vector(){return this._metadata.vector=!0,this}hooks(e){return this._metadata.hooks=e,this}validate(...e){return this._metadata.validate=e,this}serial(e){return this._metadata.serial=e,this}}.create;function N(e){return M(`uuid`,e)}N();var P=class{_input=null;_output=null;_context=null;#steps=[];set steps(e){this.#steps=e}get steps(){return Array.from(this.#steps)}#options={};set options(e){this.#options=e}get options(){return this.#options}#output=null;set output(e){this.#output=e}get output(){return this.#output}#outputMapper=null;set outputMapper(e){this.#outputMapper=e}get outputMapper(){return this.#outputMapper}constructor(e,t,n,r={defaults:{}}){this.queryType=e,this.name=t,this.input=n,this.steps=[],this.options=r}fnStep(e,t,n){return this.#steps.push([`fn`,e,t,n]),this}sqlStep(e,t,n){return this.#steps.push([`sql`,e,t,n]),this}gqlStep(e,t,n){return this.#steps.push([`gql`,e,t,n]),this}returns(e,t){return this.outputMapper=e,this.output=t,this}};function F(e,t,n){return new P(`mutation`,e,t,n)}h`
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
`;const I={...j};F(`add`,I.type({a:I.int(),b:I.int()})).fnStep(`step1`,e=>e.input.a+e.input.b).returns(e=>({result:e.step1}),I.type({result:I.int()})),globalThis.main=e=>e.input.a+e.input.b;
//# sourceMappingURL=add__step1.js.map