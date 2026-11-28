export interface ContentCard_Family3Props {
  title: string;
  media?: string;
  actionLabels: readonly string[];
  variant?: 'compact';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function ContentCard_Family3(props: Readonly<ContentCard_Family3Props>) {
  return (
    <article data-component="ContentCard_Family3" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.media ? <img data-slot="media" src={props.media} alt="" /> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.children}
    </article>
  );
}
