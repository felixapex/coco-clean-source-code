export interface Sidebar_Family4Props {
  title: string;
  actionLabels: readonly string[];
  variant?: 'default';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function Sidebar_Family4(props: Readonly<Sidebar_Family4Props>) {
  return (
    <section data-component="Sidebar_Family4" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.children}
    </section>
  );
}
