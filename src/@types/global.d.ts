declare module '@json2csv/plainjs' {
  export type FieldValueCallback = FieldValueCallbackWithoutField | FieldValueCallbackWithField;

  export interface FieldValueCallbackWithoutField {
    (row: any): any;
  }

  export interface FieldValueCallbackWithField {
    (row: any, field: FieldValueCallbackInfo): any;
  }
  export interface FieldInfo {
    label?: string;
    default?: any;
    value: any | FieldValueCallback;
  }

  export type Flatten = {
    objects: true;
    arrays: false;
    separator: '.';
  };

  export type Unwind = {
    paths: string[];
    blankout: false;
  };

  export type Transform = {
    flatten?: Flatten;
    unwind?: Unwind;
  };

  export type Formatters = {
    undefined?: any;
    boolean?: any;
    number?: any;
    bigint?: any;
    string?: any;
    symbol?: any;
    function?: any;
    object?: any;
    headers?: any;
  };

  export type Options = {
    fields?: Array<string | FieldInfo<T>>;
    transforms?: Transform[];
    formatters?: Formatters;
    defaultValue?: any;
    delimiter?: ',';
    eol?: string;
    header?: true;
    includeEmptyRows?: false;
    withBOM?: false;
  };
  export class Parser {
    constructor(options?: Options);

    parse: <T>(data: T[]) => string;
  }
}
