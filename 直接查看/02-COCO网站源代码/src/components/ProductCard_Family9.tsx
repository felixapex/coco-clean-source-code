export interface ProductCard_Family9Props {
  title: string;
  price: string;
  media: string;
  actionLabels: readonly string[];
  variant?: 'compact';
  state?: 'default';
  instanceId?: string;
  children?: any;
}

export function ProductCard_Family9(props: Readonly<ProductCard_Family9Props>) {
  return (
    <article data-component="ProductCard_Family9" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}>
      {props.title ? <h3 data-slot="title">{props.title}</h3> : null}
      {props.price ? <p data-slot="price">{props.price}</p> : null}
      {props.media ? <img data-slot="media" src={props.media} alt="" /> : null}
      {props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}
      {props.children}
    </article>
  );
}
