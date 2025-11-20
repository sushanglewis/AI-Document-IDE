FROM nginx:alpine
COPY ./index.html /usr/share/nginx/html/index.html
COPY ./styles.css /usr/share/nginx/html/styles.css
COPY ./main.js /usr/share/nginx/html/main.js
RUN sed -i 's@location / {@location / {@' /etc/nginx/conf.d/default.conf
EXPOSE 80