export interface Sidebar_Family1Props {
  price: string;
  variant?: 'default';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function Sidebar_Family1(props: Readonly<Sidebar_Family1Props>) {
  return (
    <section data-component="Sidebar_Family1" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.price ? <p data-slot="price">{props.price}</p> : null}
      {props.children}
    </section>
  );
}
