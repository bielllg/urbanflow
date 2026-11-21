export function queryTooLong(request:Request){
  return new URL(request.url).search.length>2048;
}

export function invalidQuery(){
  return Response.json({error:'Parâmetros de consulta excedem o limite.'},{
    status:414,headers:{'Cache-Control':'no-store'},
  });
}
