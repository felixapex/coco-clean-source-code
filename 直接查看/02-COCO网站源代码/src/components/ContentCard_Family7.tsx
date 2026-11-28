export interface ContentCard_Family7Props {
  title: string;
  media?: string;
  variant?: 'compact';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function ContentCard_Family7(props: Readonly<ContentCard_Family7Props>) {
  return (
    <article data-component="ContentCard_Family7" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.media ? <img data-slot="media" src={props.media} alt="" /> : null}
      {props.children}
    </article>
  );
}
