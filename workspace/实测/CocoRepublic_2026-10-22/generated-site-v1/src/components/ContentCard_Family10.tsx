export interface ContentCard_Family10Props {
  title: string;
  actionLabels?: readonly string[];
  variant?: 'compact';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function ContentCard_Family10(props: Readonly<ContentCard_Family10Props>) {
  return (
    <article data-component="ContentCard_Family10" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.children}
    </article>
  );
}
