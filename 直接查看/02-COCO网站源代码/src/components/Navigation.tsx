export interface NavigationProps {
  title: string;
  actionLabels: readonly string[];
  items: readonly string[];
  variant?: 'default';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function Navigation(props: Readonly<NavigationProps>) {
  return (
    <nav data-component="Navigation" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.items?.map((item, index) => <span key={index}>{item}</span>)}
      {props.children}
    </nav>
  );
}
