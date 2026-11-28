export interface ContentCard_Family11Props {
  title: string;
  media?: string;
  actionLabels?: readonly string[];
  variant?: 'compact';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function ContentCard_Family11(props: Readonly<ContentCard_Family11Props>) {
  return (
    <article data-component="ContentCard_Family11" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.media ? <img data-slot="media" src={props.media} alt="" /> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.children}
    </article>
  );
}
